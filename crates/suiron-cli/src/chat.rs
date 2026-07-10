//! Chat prompt assembly, shared by the native lab/run and the WASM build.

/// Qwen3 chat wrapping via special-token ids (the encoder treats the
/// markers as plain text, so they're assembled by id).
pub fn chat_prompt(tok: &suiron_core::Tokenizer, user: &str) -> Result<Vec<u32>, String> {
    let im_start = tok.token_id("<|im_start|>").ok_or("no <|im_start|> token")?;
    let im_end = tok.token_id("<|im_end|>").ok_or("no <|im_end|> token")?;
    let mut ids = vec![im_start];
    ids.extend(tok.encode(&format!("user\n{user}")));
    ids.push(im_end);
    ids.extend(tok.encode("\n"));
    ids.push(im_start);
    ids.extend(tok.encode("assistant\n"));
    Ok(ids)
}
