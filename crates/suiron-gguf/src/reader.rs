use crate::GgufError;

/// Little-endian cursor over an in-memory byte buffer. GGUF is specified as
/// little-endian, which is also the native order on Apple Silicon.
pub(crate) struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    pub fn pos(&self) -> usize {
        self.pos
    }

    pub fn bytes(&mut self, n: usize) -> Result<&'a [u8], GgufError> {
        let end = self
            .pos
            .checked_add(n)
            .filter(|&end| end <= self.buf.len())
            .ok_or(GgufError::Eof { wanted: n })?;
        let slice = &self.buf[self.pos..end];
        self.pos = end;
        Ok(slice)
    }

    pub fn u8(&mut self) -> Result<u8, GgufError> {
        Ok(self.bytes(1)?[0])
    }

    pub fn u16(&mut self) -> Result<u16, GgufError> {
        Ok(u16::from_le_bytes(self.bytes(2)?.try_into().unwrap()))
    }

    pub fn u32(&mut self) -> Result<u32, GgufError> {
        Ok(u32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }

    pub fn u64(&mut self) -> Result<u64, GgufError> {
        Ok(u64::from_le_bytes(self.bytes(8)?.try_into().unwrap()))
    }

    pub fn string(&mut self, max_len: u64) -> Result<String, GgufError> {
        let len = self.u64()?;
        if len > max_len {
            return Err(GgufError::Sanity("string length"));
        }
        let bytes = self.bytes(len as usize)?;
        String::from_utf8(bytes.to_vec()).map_err(|_| GgufError::Utf8)
    }
}
