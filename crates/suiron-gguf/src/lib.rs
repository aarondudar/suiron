//! Parser for the GGUF container format (versions 2 and 3) used by llama.cpp
//! and the wider GGML ecosystem. Implemented from scratch on `std` only.
//!
//! A GGUF file is: a header, a list of metadata key/values, a tensor index,
//! then an aligned blob of tensor data. This crate parses the index eagerly
//! and exposes tensor data as borrowed byte slices.

mod dequant;
mod reader;
mod types;

pub use dequant::{bf16_to_f32, dequantize, dequantize_q8_0, f16_to_f32};
pub use types::{GgmlType, MetadataValue, TensorInfo};

use reader::Reader;
use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;

const MAGIC: &[u8; 4] = b"GGUF";
const DEFAULT_ALIGNMENT: u64 = 32;
// Caps on untrusted length fields so a corrupt file fails fast instead of
// attempting a multi-gigabyte allocation.
const MAX_COUNT: u64 = 1 << 24;
const MAX_STRING_LEN: u64 = 1 << 24;
const MAX_ARRAY_DEPTH: u8 = 4;

#[derive(Debug)]
pub enum GgufError {
    Io(std::io::Error),
    BadMagic([u8; 4]),
    UnsupportedVersion(u32),
    Eof { wanted: usize },
    Utf8,
    BadValueType(u32),
    Sanity(&'static str),
    UnsupportedDtype { tensor: String, dtype: GgmlType },
    OutOfBounds { tensor: String },
}

impl fmt::Display for GgufError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "io error: {e}"),
            Self::BadMagic(m) => write!(f, "not a GGUF file (magic {m:02x?})"),
            Self::UnsupportedVersion(v) => write!(f, "unsupported GGUF version {v}"),
            Self::Eof { wanted } => write!(f, "unexpected end of file (wanted {wanted} bytes)"),
            Self::Utf8 => write!(f, "invalid utf-8 in string"),
            Self::BadValueType(t) => write!(f, "unknown metadata value type {t}"),
            Self::Sanity(what) => write!(f, "implausible value for {what}"),
            Self::UnsupportedDtype { tensor, dtype } => {
                write!(f, "tensor {tensor:?} has unsupported dtype {dtype}")
            }
            Self::OutOfBounds { tensor } => {
                write!(f, "tensor {tensor:?} data lies outside the file")
            }
        }
    }
}

impl std::error::Error for GgufError {}

impl From<std::io::Error> for GgufError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

pub struct GgufFile {
    pub version: u32,
    pub metadata: BTreeMap<String, MetadataValue>,
    pub tensors: Vec<TensorInfo>,
    pub alignment: u64,
    tensor_data_start: u64,
    data: Vec<u8>,
}

impl GgufFile {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, GgufError> {
        Self::from_bytes(std::fs::read(path)?)
    }

    pub fn from_bytes(data: Vec<u8>) -> Result<Self, GgufError> {
        let mut r = Reader::new(&data);

        let magic: [u8; 4] = r.bytes(4)?.try_into().unwrap();
        if &magic != MAGIC {
            return Err(GgufError::BadMagic(magic));
        }
        let version = r.u32()?;
        // v2 and v3 share this layout; v1 used 32-bit lengths and predates
        // every model we care about.
        if !(2..=3).contains(&version) {
            return Err(GgufError::UnsupportedVersion(version));
        }

        let tensor_count = r.u64()?;
        let kv_count = r.u64()?;
        if tensor_count > MAX_COUNT || kv_count > MAX_COUNT {
            return Err(GgufError::Sanity("header counts"));
        }

        let mut metadata = BTreeMap::new();
        for _ in 0..kv_count {
            let key = r.string(MAX_STRING_LEN)?;
            let ty = r.u32()?;
            let value = read_value(&mut r, ty, 0)?;
            metadata.insert(key, value);
        }

        let mut tensors = Vec::with_capacity(tensor_count as usize);
        for _ in 0..tensor_count {
            let name = r.string(MAX_STRING_LEN)?;
            let n_dims = r.u32()?;
            if n_dims > 8 {
                return Err(GgufError::Sanity("tensor rank"));
            }
            let mut dims = Vec::with_capacity(n_dims as usize);
            for _ in 0..n_dims {
                dims.push(r.u64()?);
            }
            let dtype = GgmlType::from_u32(r.u32()?);
            let offset = r.u64()?;
            tensors.push(TensorInfo { name, dims, dtype, offset });
        }

        let alignment = metadata
            .get("general.alignment")
            .and_then(MetadataValue::to_u64)
            .unwrap_or(DEFAULT_ALIGNMENT);
        if alignment == 0 || !alignment.is_power_of_two() {
            return Err(GgufError::Sanity("general.alignment"));
        }
        let tensor_data_start = (r.pos() as u64).div_ceil(alignment) * alignment;

        let file = Self { version, metadata, tensors, alignment, tensor_data_start, data };
        for t in &file.tensors {
            // Unknown dtypes are tolerated at parse time (`inspect` should
            // still work on them); known ones must fit inside the file.
            if t.size_bytes().is_some() {
                file.tensor_bytes(t)?;
            }
        }
        Ok(file)
    }

    pub fn tensor(&self, name: &str) -> Option<&TensorInfo> {
        self.tensors.iter().find(|t| t.name == name)
    }

    /// Raw bytes of one tensor, in the file's native dtype.
    pub fn tensor_bytes(&self, info: &TensorInfo) -> Result<&[u8], GgufError> {
        let size = info.size_bytes().ok_or_else(|| GgufError::UnsupportedDtype {
            tensor: info.name.clone(),
            dtype: info.dtype,
        })?;
        let start = self.tensor_data_start.checked_add(info.offset);
        let range = start.and_then(|s| s.checked_add(size).map(|e| s as usize..e as usize));
        range
            .and_then(|range| self.data.get(range))
            .ok_or_else(|| GgufError::OutOfBounds { tensor: info.name.clone() })
    }

    /// Tensor data dequantized to f32, for the correctness-first CPU path.
    pub fn tensor_f32(&self, info: &TensorInfo) -> Result<Vec<f32>, GgufError> {
        dequantize(info.dtype, self.tensor_bytes(info)?).ok_or_else(|| {
            GgufError::UnsupportedDtype { tensor: info.name.clone(), dtype: info.dtype }
        })
    }

    pub fn get_str(&self, key: &str) -> Option<&str> {
        self.metadata.get(key)?.as_str()
    }

    pub fn get_u64(&self, key: &str) -> Option<u64> {
        self.metadata.get(key)?.to_u64()
    }

    pub fn get_f64(&self, key: &str) -> Option<f64> {
        self.metadata.get(key)?.to_f64()
    }
}

fn read_value(r: &mut Reader<'_>, ty: u32, depth: u8) -> Result<MetadataValue, GgufError> {
    Ok(match ty {
        0 => MetadataValue::U8(r.u8()?),
        1 => MetadataValue::I8(r.u8()? as i8),
        2 => MetadataValue::U16(r.u16()?),
        3 => MetadataValue::I16(r.u16()? as i16),
        4 => MetadataValue::U32(r.u32()?),
        5 => MetadataValue::I32(r.u32()? as i32),
        6 => MetadataValue::F32(f32::from_bits(r.u32()?)),
        7 => MetadataValue::Bool(r.u8()? != 0),
        8 => MetadataValue::String(r.string(MAX_STRING_LEN)?),
        9 => {
            if depth >= MAX_ARRAY_DEPTH {
                return Err(GgufError::Sanity("array nesting depth"));
            }
            let elem_ty = r.u32()?;
            let count = r.u64()?;
            if count > MAX_COUNT {
                return Err(GgufError::Sanity("array length"));
            }
            let mut items = Vec::with_capacity(count as usize);
            for _ in 0..count {
                items.push(read_value(r, elem_ty, depth + 1)?);
            }
            MetadataValue::Array(items)
        }
        10 => MetadataValue::U64(r.u64()?),
        11 => MetadataValue::I64(r.u64()? as i64),
        12 => MetadataValue::F64(f64::from_bits(r.u64()?)),
        other => return Err(GgufError::BadValueType(other)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put_str(buf: &mut Vec<u8>, s: &str) {
        buf.extend((s.len() as u64).to_le_bytes());
        buf.extend(s.as_bytes());
    }

    /// Hand-assembled GGUF v3 file: two metadata keys and one 2x3 f32 tensor.
    fn synthetic_file() -> Vec<u8> {
        let mut b = Vec::new();
        b.extend(MAGIC);
        b.extend(3u32.to_le_bytes());
        b.extend(1u64.to_le_bytes()); // tensor count
        b.extend(2u64.to_le_bytes()); // kv count

        put_str(&mut b, "general.name");
        b.extend(8u32.to_le_bytes());
        put_str(&mut b, "test-model");

        put_str(&mut b, "test.list");
        b.extend(9u32.to_le_bytes());
        b.extend(4u32.to_le_bytes()); // element type: u32
        b.extend(3u64.to_le_bytes());
        for i in [10u32, 20, 30] {
            b.extend(i.to_le_bytes());
        }

        put_str(&mut b, "blk.0.weight");
        b.extend(2u32.to_le_bytes()); // n_dims
        b.extend(2u64.to_le_bytes());
        b.extend(3u64.to_le_bytes());
        b.extend(0u32.to_le_bytes()); // dtype: f32
        b.extend(0u64.to_le_bytes()); // offset

        while b.len() % 32 != 0 {
            b.push(0);
        }
        for i in 0..6 {
            b.extend((i as f32).to_le_bytes());
        }
        b
    }

    #[test]
    fn parses_synthetic_file() {
        let f = GgufFile::from_bytes(synthetic_file()).unwrap();
        assert_eq!(f.version, 3);
        assert_eq!(f.get_str("general.name"), Some("test-model"));
        assert_eq!(f.tensors.len(), 1);

        let arr = match &f.metadata["test.list"] {
            MetadataValue::Array(items) => items,
            other => panic!("expected array, got {other:?}"),
        };
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[1].to_u64(), Some(20));

        let t = f.tensor("blk.0.weight").unwrap();
        assert_eq!(t.dims, vec![2, 3]);
        assert_eq!(t.n_elements(), 6);
        assert_eq!(t.size_bytes(), Some(24));

        let values = f.tensor_f32(t).unwrap();
        assert_eq!(values, vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0]);
    }

    #[test]
    fn rejects_bad_magic() {
        let mut b = synthetic_file();
        b[0] = b'X';
        assert!(matches!(GgufFile::from_bytes(b), Err(GgufError::BadMagic(_))));
    }

    #[test]
    fn rejects_truncated_file() {
        let mut b = synthetic_file();
        b.truncate(b.len() - 8); // chop off part of the tensor data
        assert!(GgufFile::from_bytes(b).is_err());
    }
}
