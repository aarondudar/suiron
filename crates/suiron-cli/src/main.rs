mod lab;
mod machine;
mod trace;
mod view;

use std::collections::BTreeMap;
use std::io::{self, Write};
use std::process::ExitCode;
use std::time::Instant;

use suiron_gguf::{GgufFile, MetadataValue};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("inspect") => match args.get(2) {
            Some(path) => inspect(path),
            None => usage(),
        },
        Some("vocab") => match args.get(2) {
            Some(path) => {
                let start = parse_or(args.get(3), 0);
                let count = parse_or(args.get(4), 40);
                vocab(path, start, count)
            }
            None => usage(),
        },
        Some("tokenize") => match (args.get(2), args.get(3)) {
            (Some(path), Some(_)) => tokenize(path, &args[3..].join(" ")),
            _ => usage(),
        },
        Some("load") => match args.get(2) {
            Some(path) => load(path),
            None => usage(),
        },
        Some("next") => match (args.get(2), args.get(3)) {
            (Some(path), Some(_)) => next(path, &args[3..].join(" ")),
            _ => usage(),
        },
        Some("run") => match args.get(2) {
            Some(path) => run(path, &args[3..]),
            None => usage(),
        },
        Some("trace") => match args.get(2) {
            Some(path) => trace_cmd(path, &args[3..]),
            None => usage(),
        },
        Some("view") => match args.get(2) {
            Some(path) => view::serve(path, parse_or(args.get(3), 4117) as u16),
            None => usage(),
        },
        Some("lab") => match args.get(2) {
            Some(path) => lab::serve(path, parse_or(args.get(3), 4117) as u16),
            None => usage(),
        },
        _ => usage(),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn usage() -> Result<(), Box<dyn std::error::Error>> {
    Err("usage: suiron <inspect|vocab|tokenize> <model.gguf> [args]\n\
         \x20 inspect  <model.gguf>                  dump metadata and tensors\n\
         \x20 vocab    <model.gguf> [start] [count]  print vocabulary entries\n\
         \x20 tokenize <model.gguf> <text>           encode text to token ids\n\
         \x20 load     <model.gguf>                  load all weights to f32 and verify\n\
         \x20 next     <model.gguf> <text>           predict the next token (top 10)\n\
         \x20 run      <model.gguf> -p <prompt> [-n N] [--temp T] [--top-k K]\n\
         \x20          [--top-p P] [--seed S] [--chat] [--gpu] [--backend f32|q8]\n\
         \x20                                              generate text (streams)\n\
         \x20 trace    <model.gguf> -p <prompt> [-n N] [-o out.json]   record a forward pass\n\
         \x20 view     <trace.json> [port]              serve the microscope viewer\n\
         \x20 lab      <model.gguf> [port]              live microscope: model resident,\n\
         \x20                                           prompt + inspect from the browser"
        .into())
}

/// Record a fully-instrumented generation to a trace file for `view`.
fn trace_cmd(path: &str, rest: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let mut prompt = None;
    let mut max_tokens = 16usize;
    let mut out_path = "trace.json".to_string();
    let mut it = rest.iter();
    while let Some(arg) = it.next() {
        let mut val = || it.next().ok_or_else(|| format!("{arg} needs a value"));
        match arg.as_str() {
            "-p" => prompt = Some(val()?.clone()),
            "-n" => max_tokens = val()?.parse()?,
            "-o" => out_path = val()?.clone(),
            other => return Err(format!("unknown flag {other}").into()),
        }
    }
    let prompt = prompt.ok_or("trace needs -p <prompt>")?;

    let file = GgufFile::open(path)?;
    let tok = suiron_core::Tokenizer::from_gguf(&file)?;
    let model = suiron_core::Model::load(&file)?;
    let ids = tok.encode(&prompt);
    let n_prompt = ids.len();
    let stop: Vec<u32> = [
        file.get_u64("tokenizer.ggml.eos_token_id").map(|v| v as u32),
        tok.token_id("<|endoftext|>"),
    ]
    .into_iter()
    .flatten()
    .collect();

    let mut rec = trace::Recorder::new(6);
    let mut cache = suiron_core::KvCache::new(&model);
    let mut all_ids = ids.clone();
    let mut logits = Vec::new();
    let be = suiron_core::Backend::F32; // traces use the reference math
    for &t in &ids {
        rec.begin_step();
        logits = suiron_core::forward(&model, &mut cache, t, be, Some(&mut rec));
        rec.record_logits(&logits, 10);
    }
    let mut sampler = suiron_core::Sampler::greedy(); // traces are deterministic
    for _ in 0..max_tokens {
        let (id, sel) = sampler.sample_traced(&logits);
        if stop.contains(&id) {
            break;
        }
        all_ids.push(id);
        rec.begin_step();
        logits = suiron_core::forward(&model, &mut cache, id, be, Some(&mut rec));
        rec.record_logits(&logits, 10);
        rec.set_sel(sel);
    }

    let tokens: Vec<(u32, String)> =
        all_ids.iter().map(|&id| (id, tok.decode(&[id]))).collect();
    let name = file.get_str("general.name").unwrap_or("model");
    let json = trace::write_trace(
        name, "q8_0", &model.config, &tokens, n_prompt, &rec.steps, None, None,
        |id| tok.decode(&[id]),
    );
    std::fs::write(&out_path, &json)?;
    println!(
        "traced {} positions ({} prompt + {} generated) → {out_path} ({})",
        tokens.len(),
        n_prompt,
        tokens.len() - n_prompt,
        human_bytes(json.len() as u64),
    );
    println!("view it:  suiron view {out_path}");
    Ok(())
}

/// Streaming text generation.
fn run(path: &str, rest: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    // flag parsing
    let mut prompt = None;
    let mut max_tokens = 128usize;
    let (mut temp, mut top_k, mut top_p) = (0.8f32, 40usize, 0.95f32);
    let mut seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .subsec_nanos() as u64;
    let mut chat = false;
    let mut gpu = false;
    let mut backend = suiron_core::Backend::F32;
    let mut it = rest.iter();
    while let Some(arg) = it.next() {
        let mut val = || it.next().ok_or_else(|| format!("{arg} needs a value"));
        match arg.as_str() {
            "-p" => prompt = Some(val()?.clone()),
            "-n" => max_tokens = val()?.parse()?,
            "--temp" => temp = val()?.parse()?,
            "--top-k" => top_k = val()?.parse()?,
            "--top-p" => top_p = val()?.parse()?,
            "--seed" => seed = val()?.parse()?,
            "--chat" => chat = true,
            "--gpu" => gpu = true,
            "--backend" => backend = suiron_core::Backend::parse(val()?),
            other => return Err(format!("unknown flag {other}").into()),
        }
    }
    let prompt = prompt.ok_or("run needs -p <prompt>")?;

    let file = GgufFile::open(path)?;
    let tok = suiron_core::Tokenizer::from_gguf(&file)?;
    let model = suiron_core::Model::load(&file)?;

    // stop on end-of-turn and end-of-text
    let mut stop = Vec::new();
    if let Some(eos) = file.get_u64("tokenizer.ggml.eos_token_id") {
        stop.push(eos as u32);
    }
    if let Some(id) = tok.token_id("<|endoftext|>") {
        stop.push(id);
    }

    let ids = if chat {
        chat_prompt(&tok, &prompt)?
    } else {
        tok.encode(&prompt)
    };

    let mut sampler = suiron_core::Sampler::new(temp, top_k, top_p, seed);
    if !chat {
        print!("{prompt}");
    }
    let mut out = io::stdout();
    out.flush()?;

    let mut pending: Vec<u8> = Vec::new();
    let mut on_token = |id: u32| {
        pending.extend(tok.token_bytes(id));
        flush_utf8(&mut pending, &mut out);
    };
    let stats = if gpu {
        let gm = suiron_metal::GpuModel::new(&model)?;
        generate_with(
            |cache, t| gm.forward(cache, t),
            &model, &ids, &mut sampler, max_tokens, &stop, &mut on_token,
        )
    } else {
        suiron_core::generate(&model, &ids, &mut sampler, max_tokens, &stop, backend, on_token)
    };
    println!();
    eprintln!(
        "\n[{} | prefill {} tok · {:.1} tok/s | decode {} tok · {:.1} tok/s | temp {temp} seed {seed}]",
        if gpu { "gpu".to_string() } else { format!("cpu/{}", backend.label()) },
        stats.prompt_tokens,
        stats.prefill_tps(),
        stats.gen_tokens,
        stats.decode_tps(),
    );
    Ok(())
}

/// generate() over an arbitrary forward implementation (GPU path).
fn generate_with(
    fwd: impl Fn(&mut suiron_core::KvCache, u32) -> Vec<f32>,
    model: &suiron_core::Model,
    prompt: &[u32],
    sampler: &mut suiron_core::Sampler,
    max_tokens: usize,
    stop: &[u32],
    on_token: &mut impl FnMut(u32),
) -> suiron_core::generate::GenStats {
    let mut cache = suiron_core::KvCache::new(model);
    let t0 = Instant::now();
    let mut logits = Vec::new();
    for &t in prompt {
        logits = fwd(&mut cache, t);
    }
    let prefill = t0.elapsed();
    let t1 = Instant::now();
    let mut gen_tokens = 0;
    for _ in 0..max_tokens {
        let id = sampler.sample(&logits);
        if stop.contains(&id) {
            break;
        }
        on_token(id);
        gen_tokens += 1;
        logits = fwd(&mut cache, id);
    }
    suiron_core::generate::GenStats {
        prompt_tokens: prompt.len(),
        gen_tokens,
        prefill,
        decode: t1.elapsed(),
    }
}

/// Qwen3 chat wrapping via special-token ids (the encoder treats the
/// markers as plain text, so they're assembled by id).
pub(crate) fn chat_prompt(
    tok: &suiron_core::Tokenizer,
    user: &str,
) -> Result<Vec<u32>, Box<dyn std::error::Error>> {
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

/// Print the longest valid UTF-8 prefix of `pending`; keep incomplete
/// trailing sequences buffered until the next token completes them.
fn flush_utf8(pending: &mut Vec<u8>, out: &mut impl Write) {
    loop {
        if pending.is_empty() {
            return;
        }
        match std::str::from_utf8(pending) {
            Ok(s) => {
                let _ = out.write_all(s.as_bytes());
                let _ = out.flush();
                pending.clear();
                return;
            }
            Err(e) => {
                let valid = e.valid_up_to();
                if valid > 0 {
                    let _ = out.write_all(&pending[..valid]);
                    let _ = out.flush();
                    pending.drain(..valid);
                }
                match e.error_len() {
                    // truly invalid bytes: emit replacement char, skip them
                    Some(n) => {
                        let _ = out.write_all("\u{FFFD}".as_bytes());
                        pending.drain(..n);
                    }
                    // incomplete sequence: wait for more bytes
                    None => return,
                }
            }
        }
    }
}

/// Full forward pass over the prompt; print the top-10 next-token candidates.
fn next(path: &str, text: &str) -> Result<(), Box<dyn std::error::Error>> {
    let file = GgufFile::open(path)?;
    let tok = suiron_core::Tokenizer::from_gguf(&file)?;
    let model = suiron_core::Model::load(&file)?;
    let ids = tok.encode(text);
    println!("{} prompt tokens", ids.len());

    let start = Instant::now();
    let mut cache = suiron_core::KvCache::new(&model);
    let logits = suiron_core::prefill(&model, &mut cache, &ids, suiron_core::Backend::F32);
    let elapsed = start.elapsed();

    let mut ranked: Vec<(usize, f32)> =
        logits.iter().copied().enumerate().collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));

    println!("forward pass: {elapsed:.2?} ({:.1} ms/token)\n", elapsed.as_millis() as f64 / ids.len() as f64);
    for &(id, score) in ranked.iter().take(10) {
        println!("{score:>9.4}  {id:>7}  {:?}", tok.decode(&[id as u32]));
    }
    Ok(())
}

/// Load every tensor to f32, shape-checked, and report size/time.
fn load(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let start = Instant::now();
    let file = GgufFile::open(path)?;
    let model = suiron_core::Model::load(&file)?;
    let elapsed = start.elapsed();

    let c = &model.config;
    let floats: usize = model.token_embd.data.len()
        + model.output_norm.data.len()
        + model.layers.iter().map(|l| {
            l.attn_norm.data.len() + l.wq.data.len() + l.wk.data.len() + l.wv.data.len()
                + l.wo.data.len() + l.q_norm.data.len() + l.k_norm.data.len()
                + l.ffn_norm.data.len() + l.ffn_gate.data.len() + l.ffn_up.data.len()
                + l.ffn_down.data.len()
        }).sum::<usize>();

    println!(
        "{} layers · hidden {} · {}q/{}kv heads × {} · ffn {} · vocab {}",
        c.n_layers, c.hidden, c.n_heads, c.n_kv_heads, c.head_dim, c.ffn, c.vocab
    );
    println!(
        "loaded {} tensors → {} f32 ({}) in {elapsed:.2?}, all shapes verified",
        2 + c.n_layers * 11,
        group_digits(floats as u64),
        human_bytes(floats as u64 * 4),
    );
    println!("tied output projection: {}", model.output.is_none());
    Ok(())
}

/// Encode text and show each token id with its decoded text piece.
fn tokenize(path: &str, text: &str) -> Result<(), Box<dyn std::error::Error>> {
    let file = GgufFile::open(path)?;
    let tok = suiron_core::Tokenizer::from_gguf(&file)?;
    let ids = tok.encode(text);

    println!("{} tokens: {ids:?}\n", ids.len());
    for &id in &ids {
        println!("{id:>7}  {:?}", tok.decode(&[id]));
    }
    Ok(())
}

fn parse_or(arg: Option<&String>, default: usize) -> usize {
    arg.and_then(|s| s.parse().ok()).unwrap_or(default)
}

/// Print `count` vocabulary entries starting at token id `start`.
fn vocab(path: &str, start: usize, count: usize) -> Result<(), Box<dyn std::error::Error>> {
    let file = GgufFile::open(path)?;
    let tokens = file
        .metadata
        .get("tokenizer.ggml.tokens")
        .and_then(MetadataValue::as_array)
        .ok_or("no tokenizer.ggml.tokens array in metadata")?;

    println!("{} tokens total\n", tokens.len());
    for (id, tok) in tokens.iter().enumerate().skip(start).take(count) {
        println!("{id:>7}  {:?}", tok.as_str().unwrap_or("<non-string>"));
    }
    Ok(())
}

fn inspect(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let start = Instant::now();
    let file = GgufFile::open(path)?;
    let elapsed = start.elapsed();

    let file_bytes = std::fs::metadata(path)?.len();
    println!("{path}");
    println!(
        "GGUF v{} · {} · {} tensors · {} metadata keys · parsed in {elapsed:.2?}",
        file.version,
        human_bytes(file_bytes),
        file.tensors.len(),
        file.metadata.len(),
    );

    println!("\nmetadata:");
    for (key, value) in &file.metadata {
        println!("  {key} = {value}");
    }

    println!("\ntensors:");
    for t in &file.tensors {
        let dims: Vec<String> = t.dims.iter().map(u64::to_string).collect();
        println!(
            "  {:<44} {:>8} {:>14}  [{}]",
            t.name,
            t.dtype.to_string(),
            group_digits(t.n_elements()),
            dims.join(" × "),
        );
    }

    let total_params: u64 = file.tensors.iter().map(|t| t.n_elements()).sum();
    let mut by_dtype: BTreeMap<String, u64> = BTreeMap::new();
    for t in &file.tensors {
        *by_dtype.entry(t.dtype.to_string()).or_default() += t.size_bytes().unwrap_or(0);
    }
    let breakdown: Vec<String> = by_dtype
        .iter()
        .map(|(dtype, bytes)| format!("{dtype} {}", human_bytes(*bytes)))
        .collect();
    println!("\ntotal: {} parameters ({})", group_digits(total_params), breakdown.join(", "));
    Ok(())
}

fn group_digits(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}
