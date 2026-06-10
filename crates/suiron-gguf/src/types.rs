use std::fmt;

/// GGML tensor element types, as encoded in GGUF tensor descriptors.
/// Quantized types store fixed-size blocks of elements; `block_layout`
/// gives (elements per block, bytes per block).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GgmlType {
    F32,
    F16,
    BF16,
    F64,
    I8,
    I16,
    I32,
    I64,
    Q4_0,
    Q4_1,
    Q5_0,
    Q5_1,
    Q8_0,
    Q8_1,
    Q2K,
    Q3K,
    Q4K,
    Q5K,
    Q6K,
    Q8K,
    Unknown(u32),
}

impl GgmlType {
    pub fn from_u32(v: u32) -> Self {
        match v {
            0 => Self::F32,
            1 => Self::F16,
            2 => Self::Q4_0,
            3 => Self::Q4_1,
            6 => Self::Q5_0,
            7 => Self::Q5_1,
            8 => Self::Q8_0,
            9 => Self::Q8_1,
            10 => Self::Q2K,
            11 => Self::Q3K,
            12 => Self::Q4K,
            13 => Self::Q5K,
            14 => Self::Q6K,
            15 => Self::Q8K,
            24 => Self::I8,
            25 => Self::I16,
            26 => Self::I32,
            27 => Self::I64,
            28 => Self::F64,
            30 => Self::BF16,
            other => Self::Unknown(other),
        }
    }

    pub fn block_layout(self) -> Option<(u64, u64)> {
        Some(match self {
            Self::F32 | Self::I32 => (1, 4),
            Self::F16 | Self::BF16 | Self::I16 => (1, 2),
            Self::F64 | Self::I64 => (1, 8),
            Self::I8 => (1, 1),
            Self::Q4_0 => (32, 18),
            Self::Q4_1 => (32, 20),
            Self::Q5_0 => (32, 22),
            Self::Q5_1 => (32, 24),
            Self::Q8_0 => (32, 34),
            Self::Q8_1 => (32, 36),
            Self::Q2K => (256, 84),
            Self::Q3K => (256, 110),
            Self::Q4K => (256, 144),
            Self::Q5K => (256, 176),
            Self::Q6K => (256, 210),
            Self::Q8K => (256, 292),
            Self::Unknown(_) => return None,
        })
    }
}

impl fmt::Display for GgmlType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unknown(v) => write!(f, "unknown({v})"),
            other => write!(f, "{}", format!("{other:?}").to_lowercase()),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum MetadataValue {
    U8(u8),
    I8(i8),
    U16(u16),
    I16(i16),
    U32(u32),
    I32(i32),
    U64(u64),
    I64(i64),
    F32(f32),
    F64(f64),
    Bool(bool),
    String(String),
    Array(Vec<MetadataValue>),
}

impl MetadataValue {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn to_u64(&self) -> Option<u64> {
        match *self {
            Self::U8(v) => Some(v.into()),
            Self::U16(v) => Some(v.into()),
            Self::U32(v) => Some(v.into()),
            Self::U64(v) => Some(v),
            Self::I8(v) => u64::try_from(v).ok(),
            Self::I16(v) => u64::try_from(v).ok(),
            Self::I32(v) => u64::try_from(v).ok(),
            Self::I64(v) => u64::try_from(v).ok(),
            _ => None,
        }
    }

    pub fn to_f64(&self) -> Option<f64> {
        match *self {
            Self::F32(v) => Some(v.into()),
            Self::F64(v) => Some(v),
            _ => self.to_u64().map(|v| v as f64),
        }
    }

    pub fn as_array(&self) -> Option<&[MetadataValue]> {
        match self {
            Self::Array(items) => Some(items),
            _ => None,
        }
    }
}

impl fmt::Display for MetadataValue {
    /// Human-oriented rendering: long arrays (e.g. 151k-entry vocabularies)
    /// are elided rather than dumped.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::U8(v) => write!(f, "{v}"),
            Self::I8(v) => write!(f, "{v}"),
            Self::U16(v) => write!(f, "{v}"),
            Self::I16(v) => write!(f, "{v}"),
            Self::U32(v) => write!(f, "{v}"),
            Self::I32(v) => write!(f, "{v}"),
            Self::U64(v) => write!(f, "{v}"),
            Self::I64(v) => write!(f, "{v}"),
            Self::F32(v) => write!(f, "{v}"),
            Self::F64(v) => write!(f, "{v}"),
            Self::Bool(v) => write!(f, "{v}"),
            Self::String(s) => {
                if s.len() > 80 {
                    let head: String = s.chars().take(60).collect();
                    write!(f, "{head:?}… ({} bytes)", s.len())
                } else {
                    write!(f, "{s:?}")
                }
            }
            Self::Array(items) => {
                write!(f, "[")?;
                for (i, item) in items.iter().take(4).enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "{item}")?;
                }
                if items.len() > 4 {
                    write!(f, ", … {} items", items.len())?;
                }
                write!(f, "]")
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct TensorInfo {
    pub name: String,
    /// Dimensions in GGUF order: `dims[0]` is the contiguous (innermost) axis.
    pub dims: Vec<u64>,
    pub dtype: GgmlType,
    /// Byte offset relative to the start of the tensor data section.
    pub offset: u64,
}

impl TensorInfo {
    pub fn n_elements(&self) -> u64 {
        self.dims.iter().product()
    }

    /// `None` when the dtype is unknown or the element count doesn't fill
    /// whole quantization blocks.
    pub fn size_bytes(&self) -> Option<u64> {
        let (block_elems, block_bytes) = self.dtype.block_layout()?;
        let n = self.n_elements();
        n.is_multiple_of(block_elems).then(|| n / block_elems * block_bytes)
    }
}
