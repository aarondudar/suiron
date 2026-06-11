//! Byte-level BPE tokenizer (`tokenizer.ggml.model = "gpt2"`, `pre = "qwen2"`).
//! encode: pre-tokenize → byte-map → merge by rank → vocab lookup.
//! Verified token-exact against llama-tokenize; fixtures in tests/real_model.rs.

use std::collections::HashMap;
use suiron_gguf::{GgufFile, MetadataValue};

pub struct Tokenizer {
    /// vocab string (byte-mapped form) → token id
    id_of: HashMap<String, u32>,
    /// token id → vocab string (byte-mapped form)
    token_of: Vec<String>,
    /// "left right" merge pair → rank (lower merges first)
    merge_rank: HashMap<String, u32>,
    /// byte value → stand-in char
    byte_char: [char; 256],
    /// stand-in char → byte value
    char_byte: HashMap<char, u8>,
}

impl Tokenizer {
    pub fn from_gguf(file: &GgufFile) -> Result<Self, String> {
        let tokens = file
            .metadata
            .get("tokenizer.ggml.tokens")
            .and_then(MetadataValue::as_array)
            .ok_or("missing tokenizer.ggml.tokens")?;
        let merges = file
            .metadata
            .get("tokenizer.ggml.merges")
            .and_then(MetadataValue::as_array)
            .ok_or("missing tokenizer.ggml.merges")?;

        let mut id_of = HashMap::with_capacity(tokens.len());
        let mut token_of = Vec::with_capacity(tokens.len());
        for (id, tok) in tokens.iter().enumerate() {
            let s = tok.as_str().ok_or("non-string vocab entry")?;
            id_of.insert(s.to_string(), id as u32);
            token_of.push(s.to_string());
        }

        let mut merge_rank = HashMap::with_capacity(merges.len());
        for (rank, m) in merges.iter().enumerate() {
            let s = m.as_str().ok_or("non-string merge entry")?;
            merge_rank.insert(s.to_string(), rank as u32);
        }

        let byte_char = byte_to_char_table();
        let mut char_byte = HashMap::with_capacity(256);
        for (b, &c) in byte_char.iter().enumerate() {
            char_byte.insert(c, b as u8);
        }

        Ok(Self { id_of, token_of, merge_rank, byte_char, char_byte })
    }

    pub fn encode(&self, text: &str) -> Vec<u32> {
        let chars: Vec<char> = text.chars().collect();
        let mut ids = Vec::new();
        let mut i = 0;
        while i < chars.len() {
            let end = pretoken_end(&chars, i);
            let pre: String = chars[i..end].iter().collect();
            i = end;

            let mapped: String =
                pre.bytes().map(|b| self.byte_char[b as usize]).collect();
            for part in self.bpe(&mapped) {
                match self.id_of.get(&part) {
                    Some(&id) => ids.push(id),
                    // Unmergeable part: fall back to single-byte tokens.
                    None => {
                        for c in part.chars() {
                            if let Some(&id) = self.id_of.get(c.to_string().as_str()) {
                                ids.push(id);
                            }
                        }
                    }
                }
            }
        }
        ids
    }

    pub fn decode(&self, ids: &[u32]) -> String {
        let mut bytes = Vec::new();
        for &id in ids {
            let Some(tok) = self.token_of.get(id as usize) else { continue };
            for c in tok.chars() {
                match self.char_byte.get(&c) {
                    Some(&b) => bytes.push(b),
                    // not a stand-in (special tokens): pass through
                    None => bytes.extend(c.to_string().as_bytes()),
                }
            }
        }
        String::from_utf8_lossy(&bytes).into_owned()
    }

    pub fn vocab_size(&self) -> usize {
        self.token_of.len()
    }

    /// Raw bytes of one token — may be a partial UTF-8 sequence, so streaming
    /// callers must buffer until valid (see cli's flush_utf8).
    pub fn token_bytes(&self, id: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        let Some(tok) = self.token_of.get(id as usize) else { return bytes };
        for c in tok.chars() {
            match self.char_byte.get(&c) {
                Some(&b) => bytes.push(b),
                None => bytes.extend(c.to_string().as_bytes()),
            }
        }
        bytes
    }

    /// Exact vocab lookup (special tokens like "<|im_start|>" are stored
    /// verbatim, so this is how the chat template finds their ids).
    pub fn token_id(&self, s: &str) -> Option<u32> {
        self.id_of.get(s).copied()
    }

    /// Greedy BPE: keep merging the adjacent pair with the lowest rank
    /// until no pair is in the merge table. O(n²), fine for pre-token sizes.
    fn bpe(&self, piece: &str) -> Vec<String> {
        let mut parts: Vec<String> = piece.chars().map(String::from).collect();
        loop {
            let mut best: Option<(u32, usize)> = None;
            for w in 0..parts.len().saturating_sub(1) {
                let key = format!("{} {}", parts[w], parts[w + 1]);
                if let Some(&rank) = self.merge_rank.get(&key) {
                    if best.is_none_or(|(r, _)| rank < r) {
                        best = Some((rank, w));
                    }
                }
            }
            let Some((_, w)) = best else { return parts };
            let right = parts.remove(w + 1);
            parts[w].push_str(&right);
        }
    }
}

/// GPT-2 byte↔char table: printable bytes map to themselves, the rest to
/// chars 256+. Space (0x20) → 'Ġ'.
fn byte_to_char_table() -> [char; 256] {
    let mut table = ['\0'; 256];
    let mut next = 0u32;
    for b in 0..=255u32 {
        let printable = (0x21..=0x7e).contains(&b)
            || (0xa1..=0xac).contains(&b)
            || (0xae..=0xff).contains(&b);
        table[b as usize] = if printable {
            char::from_u32(b).unwrap()
        } else {
            next += 1;
            char::from_u32(256 + next - 1).unwrap()
        };
    }
    table
}

/// End index of the pre-token starting at `i`. Hand-rolled equivalent of
/// llama.cpp's qwen2 pattern, alternatives tried in order:
///   (?i:'s|'t|'re|'ve|'m|'ll|'d)    contractions
///   [^\r\n\p{L}\p{N}]?\p{L}+        optional prefix char + letters
///   \p{N}{1,3}                      1-3 digits
///    ?[^\s\p{L}\p{N}]+[\r\n]*       optional space + punct + newlines
///   \s*[\r\n]+                      ws ending in newlines
///   \s+(?!\S)                       trailing ws (keep last for next word)
///   \s+                             any other ws
fn pretoken_end(chars: &[char], i: usize) -> usize {
    let len = chars.len();
    let c = chars[i];

    // 1. contractions
    if c == '\'' && i + 1 < len {
        let p1 = chars[i + 1].to_ascii_lowercase();
        if matches!(p1, 's' | 't' | 'm' | 'd') {
            return i + 2;
        }
        if i + 2 < len {
            let p2 = chars[i + 2].to_ascii_lowercase();
            if matches!((p1, p2), ('r', 'e') | ('v', 'e') | ('l', 'l')) {
                return i + 3;
            }
        }
    }

    let is_letter = |c: char| c.is_alphabetic();
    let is_digit = |c: char| c.is_numeric();

    // 2. optional single non-letter/digit/newline char, then letters
    {
        let mut j = i;
        if !is_letter(c) && !is_digit(c) && c != '\r' && c != '\n'
            && j + 1 < len && is_letter(chars[j + 1])
        {
            j += 1;
        }
        if is_letter(chars[j]) {
            while j < len && is_letter(chars[j]) {
                j += 1;
            }
            return j;
        }
    }

    // 3. one to three digits
    if is_digit(c) {
        let mut j = i;
        while j < len && is_digit(chars[j]) && j - i < 3 {
            j += 1;
        }
        return j;
    }

    // 4. optional space, then punctuation run, then trailing newlines
    let is_punct = |c: char| !c.is_whitespace() && !is_letter(c) && !is_digit(c);
    {
        let mut j = i;
        if chars[j] == ' ' && j + 1 < len && is_punct(chars[j + 1]) {
            j += 1;
        }
        if is_punct(chars[j]) {
            while j < len && is_punct(chars[j]) {
                j += 1;
            }
            while j < len && (chars[j] == '\r' || chars[j] == '\n') {
                j += 1;
            }
            return j;
        }
    }

    // 5-7. whitespace runs (c is whitespace if we got here)
    let mut w = i;
    while w < len && chars[w].is_whitespace() {
        w += 1;
    }
    // 5. \s*[\r\n]+ — match through the last newline in the run
    if let Some(p) = (i..w).rev().find(|&p| chars[p] == '\r' || chars[p] == '\n') {
        return p + 1;
    }
    // 6. \s+(?!\S) — at end of text take it all; otherwise leave the last
    //    whitespace char to attach to the next word
    if w == len || w - i > 1 {
        return if w == len { w } else { w - 1 };
    }
    // 7. \s+
    w
}

#[cfg(test)]
mod tests {
    use super::*;

    fn split(text: &str) -> Vec<String> {
        let chars: Vec<char> = text.chars().collect();
        let mut out = Vec::new();
        let mut i = 0;
        while i < chars.len() {
            let end = pretoken_end(&chars, i);
            assert!(end > i, "scanner must always make progress");
            out.push(chars[i..end].iter().collect());
            i = end;
        }
        out
    }

    #[test]
    fn byte_table_is_a_bijection() {
        let table = byte_to_char_table();
        let mut seen = std::collections::HashSet::new();
        for &c in &table {
            assert!(seen.insert(c), "duplicate stand-in char {c:?}");
        }
        assert_eq!(table[b' ' as usize], 'Ġ'); // the famous space marker
        assert_eq!(table[b'a' as usize], 'a'); // printable bytes unchanged
    }

    #[test]
    fn scanner_splits_words_and_punctuation() {
        assert_eq!(split("Hello, world!"), vec!["Hello", ",", " world", "!"]);
        assert_eq!(split("the cat sat"), vec!["the", " cat", " sat"]);
    }

    #[test]
    fn scanner_contractions_and_digits() {
        assert_eq!(split("I'm 42"), vec!["I", "'m", " ", "42"]);
        // digits chunked 3 at a time, space split off before digits
        assert_eq!(split("12345"), vec!["123", "45"]);
    }

    #[test]
    fn scanner_whitespace_rules() {
        // multi-space run before a word: last space goes with the word
        assert_eq!(split("a   b"), vec!["a", "  ", " b"]);
        // newlines group with preceding whitespace
        assert_eq!(split("a \n b"), vec!["a", " \n", " b"]);
        // trailing whitespace is its own token
        assert_eq!(split("a  "), vec!["a", "  "]);
    }

    #[test]
    fn bpe_merges_by_rank() {
        // Tiny synthetic tokenizer: vocab {a, b, c, ab, abc}, merges
        // "a b" (rank 0) then "ab c" (rank 1).
        let mut id_of = HashMap::new();
        for (i, s) in ["a", "b", "c", "ab", "abc"].iter().enumerate() {
            id_of.insert(s.to_string(), i as u32);
        }
        let mut merge_rank = HashMap::new();
        merge_rank.insert("a b".to_string(), 0);
        merge_rank.insert("ab c".to_string(), 1);
        let byte_char = byte_to_char_table();
        let mut char_byte = HashMap::new();
        for (b, &c) in byte_char.iter().enumerate() {
            char_byte.insert(c, b as u8);
        }
        let t = Tokenizer {
            id_of,
            token_of: vec!["a".into(), "b".into(), "c".into(), "ab".into(), "abc".into()],
            merge_rank,
            byte_char,
            char_byte,
        };
        assert_eq!(t.bpe("abc"), vec!["abc"]); // a+b first, then ab+c
        assert_eq!(t.bpe("acb"), vec!["a", "c", "b"]); // no rule applies
        assert_eq!(t.encode("abc"), vec![4]);
        assert_eq!(t.decode(&[4]), "abc");
    }
}
