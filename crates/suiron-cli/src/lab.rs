//! Live microscope backend: model stays resident, the web/ frontend drives it.
//! API (v1):
//!   GET  /api/v1/trace      current state (poll while busy)
//!   POST /api/v1/generate?n=&temp=&top_k=&top_p=&seed=&chat=   prompt = body
//!   POST /api/v1/stop
//! Anything else is served from web/dist (the built React app); in frontend
//! dev, run `npm run dev` in web/ instead — vite proxies /api here.

use crate::trace::{write_trace, Recorder, Step};
use crate::view::{respond, serve_static};
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use suiron_core::{forward, Backend, KvCache, Model, Sampler, Tokenizer};

struct Shared {
    tokens: Vec<(u32, String)>,
    steps: Vec<Step>,
    n_prompt: usize,
    busy: bool,
    seq: u64,
    /// KV cache of the last completed run — kept so forks rewind instantly.
    cache: Option<KvCache>,
    /// Logits at the final position — kept so `step` can continue sampling.
    last_logits: Vec<f32>,
    /// (position, discarded tail text) of the most recent fork.
    fork: Option<(usize, String)>,
    /// backend of the most recent run, and last measured decode tok/s per
    /// backend — drives the lab's speed comparison.
    last_backend: Backend,
    tps_f32: Option<f64>,
    tps_q8: Option<f64>,
}

#[derive(Clone, Copy)]
struct Params {
    n: usize,
    temp: f32,
    top_k: usize,
    top_p: f32,
    seed: u64,
    chat: bool,
    backend: Backend,
}

pub fn serve(model_path: &str, port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let file = suiron_gguf::GgufFile::open(model_path)?;
    let tok = Arc::new(Tokenizer::from_gguf(&file)?);
    eprintln!("loading weights…");
    let model = Arc::new(Model::load(&file)?);
    let model_name = file.get_str("general.name").unwrap_or("model").to_string();
    let stop_ids: Arc<Vec<u32>> = Arc::new(
        [
            file.get_u64("tokenizer.ggml.eos_token_id").map(|v| v as u32),
            tok.token_id("<|endoftext|>"),
        ]
        .into_iter()
        .flatten()
        .collect(),
    );

    let shared = Arc::new(Mutex::new(Shared {
        tokens: Vec::new(),
        steps: Vec::new(),
        n_prompt: 0,
        busy: false,
        seq: 0,
        cache: None,
        last_logits: Vec::new(),
        fork: None,
        last_backend: Backend::F32,
        tps_f32: None,
        tps_q8: None,
    }));
    let stop_flag = Arc::new(AtomicBool::new(false));

    let listener = TcpListener::bind(("127.0.0.1", port))?;
    println!("suiron lab · http://127.0.0.1:{port}  (model resident, ctrl-c to stop)");

    for stream in listener.incoming() {
        let Ok(mut s) = stream else { continue };
        let Some((method, path, body)) = read_request(&mut s) else { continue };

        match (method.as_str(), path.split('?').next().unwrap_or("")) {
            ("GET", "/api/v1/trace") => {
                let st = shared.lock().unwrap();
                let live = crate::trace::Live {
                    busy: st.busy,
                    seq: st.seq,
                    backend: st.last_backend.label(),
                    tps_f32: st.tps_f32,
                    tps_q8: st.tps_q8,
                };
                let json = write_trace(
                    &model_name,
                    "q8_0",
                    &model.config,
                    &st.tokens,
                    st.n_prompt,
                    &st.steps,
                    Some(&live),
                    st.fork.as_ref(),
                    |id| tok.decode(&[id]),
                );
                respond(&mut s, "200 OK", "application/json", json.as_bytes());
            }
            ("GET", "/api/v1/quant-sample") => {
                // one real Q8_0 block from layer 0's Q projection: the f16
                // scale + 32 int8 quants + the f32 values they reconstruct to.
                let json = quant_sample_json(&model);
                respond(&mut s, "200 OK", "application/json", json.as_bytes());
            }
            ("GET", "/api/v1/neighbors") => {
                // cosine neighbors of a token over the embedding matrix. Pure
                // read of the resident model — safe to answer even while busy.
                let (id, n) = parse_neighbors(&path);
                if id == u32::MAX || id as usize >= model.config.vocab {
                    respond(&mut s, "400 Bad Request", "text/plain", b"bad id");
                } else {
                    let nbrs = model.neighbors_of(id, n.clamp(1, 64));
                    let mut j = String::from("[");
                    for (i, (tid, cos)) in nbrs.iter().enumerate() {
                        if i > 0 {
                            j.push(',');
                        }
                        let text = tok.decode(&[*tid]);
                        j.push_str(&format!(
                            "{{\"id\":{tid},\"token\":\"{}\",\"cos\":{cos:.6}}}",
                            crate::trace::escape_json(&text)
                        ));
                    }
                    j.push(']');
                    respond(&mut s, "200 OK", "application/json", j.as_bytes());
                }
            }
            ("GET", "/api/v1/source") => {
                let name = path
                    .split_once("fn=")
                    .map(|(_, v)| v.split('&').next().unwrap_or(""))
                    .unwrap_or("");
                match crate::machine::source_for(name) {
                    Some(src) => respond(&mut s, "200 OK", "text/plain; charset=utf-8", src.as_bytes()),
                    None => respond(&mut s, "404 Not Found", "text/plain", b"unknown fn"),
                }
            }
            ("GET", "/api/v1/inspect") => {
                let (pos, layer) = parse_inspect(&path);
                let setup = {
                    let st = shared.lock().unwrap();
                    if st.busy {
                        Err("busy")
                    } else if pos >= st.tokens.len() || layer >= model.config.n_layers {
                        Err("bad pos/layer")
                    } else if let Some(cache) = &st.cache {
                        // clone so the resident cache (and future forks) are untouched
                        let mut c = cache.clone();
                        c.truncate(pos);
                        Ok((c, st.tokens[pos].0))
                    } else {
                        Err("nothing to inspect — generate first")
                    }
                };
                match setup {
                    Err(e) => respond(&mut s, "409 Conflict", "text/plain", e.as_bytes()),
                    Ok((mut c, id)) => {
                        // deep inspection always uses the f32 reference math
                        let mut deep = crate::machine::DeepObserver::new(layer);
                        forward(&model, &mut c, id, Backend::F32, Some(&mut deep));
                        let text = tok.decode(&[id]);
                        let json = crate::machine::inspect_json(&deep, pos, (id, &text));
                        respond(&mut s, "200 OK", "application/json", json.as_bytes());
                    }
                }
            }
            ("POST", "/api/v1/step") => {
                let params = parse_params(&path);
                let setup = {
                    let mut st = shared.lock().unwrap();
                    if st.busy {
                        Err("busy")
                    } else if st.cache.is_none() || st.last_logits.is_empty() {
                        Err("nothing to continue — generate first")
                    } else {
                        st.busy = true;
                        st.seq += 1;
                        Ok((st.cache.take().unwrap(), std::mem::take(&mut st.last_logits)))
                    }
                };
                match setup {
                    Err(e) => respond(&mut s, "409 Conflict", "text/plain", e.as_bytes()),
                    Ok((cache, logits)) => {
                        stop_flag.store(false, Ordering::Relaxed);
                        let (model, tok, shared, stop_flag, stop_ids) = (
                            Arc::clone(&model),
                            Arc::clone(&tok),
                            Arc::clone(&shared),
                            Arc::clone(&stop_flag),
                            Arc::clone(&stop_ids),
                        );
                        std::thread::spawn(move || {
                            step_traced(
                                &model, &tok, cache, logits, params, &shared, &stop_flag,
                                &stop_ids,
                            );
                        });
                        respond(&mut s, "200 OK", "text/plain", b"stepping");
                    }
                }
            }
            ("POST", "/api/v1/stop") => {
                stop_flag.store(true, Ordering::Relaxed);
                respond(&mut s, "200 OK", "text/plain", b"stopping");
            }
            ("POST", "/api/v1/generate") => {
                let prompt = String::from_utf8_lossy(&body).into_owned();
                if prompt.trim().is_empty() {
                    respond(&mut s, "400 Bad Request", "text/plain", b"empty prompt");
                    continue;
                }
                let params = parse_params(&path);
                {
                    let mut st = shared.lock().unwrap();
                    if st.busy {
                        respond(&mut s, "409 Conflict", "text/plain", b"busy");
                        continue;
                    }
                    st.busy = true;
                    st.tokens.clear();
                    st.steps.clear();
                    st.cache = None;
                    st.fork = None;
                    st.seq += 1;
                }
                stop_flag.store(false, Ordering::Relaxed);
                let (model, tok, shared, stop_flag, stop_ids) = (
                    Arc::clone(&model),
                    Arc::clone(&tok),
                    Arc::clone(&shared),
                    Arc::clone(&stop_flag),
                    Arc::clone(&stop_ids),
                );
                std::thread::spawn(move || {
                    generate_traced(&model, &tok, &prompt, params, &shared, &stop_flag, &stop_ids);
                });
                respond(&mut s, "200 OK", "text/plain", b"started");
            }
            ("POST", "/api/v1/fork") => {
                let params = parse_params(&path);
                let (pos, forced) = parse_fork(&path);
                let setup = {
                    let mut st = shared.lock().unwrap();
                    if st.busy {
                        Err("busy")
                    } else if forced == u32::MAX || pos == 0 || pos > st.tokens.len() {
                        Err("bad pos/token")
                    } else if st.cache.is_none() {
                        Err("nothing to fork — generate first")
                    } else {
                        let mut cache = st.cache.take().unwrap();
                        cache.truncate(pos);
                        let prev: String =
                            st.tokens[pos..].iter().map(|(_, t)| t.as_str()).collect();
                        // model's preferences at the fork point, for the trace
                        let model_top = st.steps[pos - 1].top.clone();
                        st.tokens.truncate(pos);
                        st.steps.truncate(pos);
                        // forking inside the prompt makes the rest generated
                        st.n_prompt = st.n_prompt.min(pos);
                        st.fork = Some((pos, prev));
                        st.busy = true;
                        st.seq += 1;
                        Ok((cache, model_top))
                    }
                };
                match setup {
                    Err(e) => respond(&mut s, "409 Conflict", "text/plain", e.as_bytes()),
                    Ok((cache, model_top)) => {
                        stop_flag.store(false, Ordering::Relaxed);
                        let (model, tok, shared, stop_flag, stop_ids) = (
                            Arc::clone(&model),
                            Arc::clone(&tok),
                            Arc::clone(&shared),
                            Arc::clone(&stop_flag),
                            Arc::clone(&stop_ids),
                        );
                        std::thread::spawn(move || {
                            fork_traced(
                                &model, &tok, cache, forced, &model_top, params, &shared,
                                &stop_flag, &stop_ids,
                            );
                        });
                        respond(&mut s, "200 OK", "text/plain", b"forked");
                    }
                }
            }
            ("GET", p) => serve_static(&mut s, p),
            _ => respond(&mut s, "404 Not Found", "text/plain", b"not found"),
        }
    }
    Ok(())
}

fn generate_traced(
    model: &Model,
    tok: &Tokenizer,
    prompt: &str,
    p: Params,
    shared: &Mutex<Shared>,
    stop_flag: &AtomicBool,
    stop_ids: &[u32],
) {
    let ids = if p.chat {
        crate::chat_prompt(tok, prompt).unwrap_or_else(|_| tok.encode(prompt))
    } else {
        tok.encode(prompt)
    };
    {
        let mut st = shared.lock().unwrap();
        st.n_prompt = ids.len();
    }

    let mut rec = Recorder::new(6);
    let mut cache = KvCache::new(model);
    let mut logits = Vec::new();

    for &t in &ids {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }
        rec.begin_step();
        logits = forward(model, &mut cache, t, p.backend, Some(&mut rec));
        rec.record_logits(&logits, 10);
        push_step(tok, &mut rec, t, shared);
    }

    let logits = run_decode(model, tok, &mut rec, &mut cache, logits, p, shared, stop_flag, stop_ids);
    finish(shared, cache, logits);
}

/// Continue n tokens from wherever the resident state stands ("step").
#[allow(clippy::too_many_arguments)]
fn step_traced(
    model: &Model,
    tok: &Tokenizer,
    mut cache: KvCache,
    logits: Vec<f32>,
    p: Params,
    shared: &Mutex<Shared>,
    stop_flag: &AtomicBool,
    stop_ids: &[u32],
) {
    let mut rec = Recorder::new(6);
    let logits = run_decode(model, tok, &mut rec, &mut cache, logits, p, shared, stop_flag, stop_ids);
    finish(shared, cache, logits);
}

/// Continue from a forked cache: stamp the human-forced token, then let the
/// model carry on. `model_top` = the model's own predictions at the fork
/// point, recorded into the forced token's selection trace.
#[allow(clippy::too_many_arguments)]
fn fork_traced(
    model: &Model,
    tok: &Tokenizer,
    mut cache: KvCache,
    forced: u32,
    model_top: &[(u32, f32)],
    p: Params,
    shared: &Mutex<Shared>,
    stop_flag: &AtomicBool,
    stop_ids: &[u32],
) {
    use suiron_core::sampling::{Cand, SampleTrace};

    let mut cand: Vec<Cand> = model_top
        .iter()
        .map(|&(id, prob)| Cand {
            id,
            logit: 0.0, // not retained across runs; viewer hides it for forced
            p: prob,
            p_final: if id == forced { 1.0 } else { 0.0 },
            cut: None,
        })
        .collect();
    if !cand.iter().any(|c| c.id == forced) {
        cand.push(Cand { id: forced, logit: 0.0, p: 0.0, p_final: 1.0, cut: None });
    }
    let sel = SampleTrace {
        temperature: p.temp,
        top_k: p.top_k,
        top_p: p.top_p,
        seed: p.seed,
        r: None,
        chosen: forced,
        forced: true,
        cand,
    };

    let mut rec = Recorder::new(6);
    rec.begin_step();
    let logits = forward(model, &mut cache, forced, p.backend, Some(&mut rec));
    rec.record_logits(&logits, 10);
    rec.set_sel(sel);
    push_step(tok, &mut rec, forced, shared);

    let logits = run_decode(model, tok, &mut rec, &mut cache, logits, p, shared, stop_flag, stop_ids);
    finish(shared, cache, logits);
}

/// The sampling loop shared by generate, fork, and step. Returns the logits
/// at the final position so the next `step` can pick up where this left off.
#[allow(clippy::too_many_arguments)]
fn run_decode(
    model: &Model,
    tok: &Tokenizer,
    rec: &mut Recorder,
    cache: &mut KvCache,
    mut logits: Vec<f32>,
    p: Params,
    shared: &Mutex<Shared>,
    stop_flag: &AtomicBool,
    stop_ids: &[u32],
) -> Vec<f32> {
    let mut sampler = Sampler::new(p.temp, p.top_k, p.top_p, p.seed);
    let mut fwd_time = std::time::Duration::ZERO;
    let mut fwd_count = 0u32;
    for _ in 0..p.n {
        if stop_flag.load(Ordering::Relaxed) || logits.is_empty() {
            break;
        }
        let (id, sel) = sampler.sample_traced(&logits);
        if stop_ids.contains(&id) {
            break;
        }
        rec.begin_step();
        let t = std::time::Instant::now();
        logits = forward(model, cache, id, p.backend, Some(&mut *rec));
        fwd_time += t.elapsed();
        fwd_count += 1;
        rec.record_logits(&logits, 10);
        rec.set_sel(sel);
        push_step(tok, rec, id, shared);
    }
    // record decode tok/s for this backend (per-token forward cost)
    if fwd_count > 0 {
        let tps = fwd_count as f64 / fwd_time.as_secs_f64().max(1e-9);
        let mut st = shared.lock().unwrap();
        st.last_backend = p.backend;
        match p.backend {
            Backend::F32 => st.tps_f32 = Some(tps),
            Backend::Q8 => st.tps_q8 = Some(tps),
        }
    }
    logits
}

/// One real Q8_0 block from `blk.0.attn_q` → JSON for the quant explainer:
/// the shared f16 scale, the 32 int8 quants, and the f32 values they
/// reconstruct to (value = scale × quant). All real, from the loaded model.
fn quant_sample_json(model: &Model) -> String {
    let mut j = String::from("{\"tensor\":\"blk.0.attn_q\"");
    if let Some(b) = model.layers[0].wq.q8.as_ref() {
        let block = &b[..34];
        let scale = suiron_gguf::f16_to_f32(u16::from_le_bytes([block[0], block[1]]));
        j.push_str(&format!(",\"scale\":{scale:.6},\"quants\":["));
        for i in 0..32 {
            if i > 0 {
                j.push(',');
            }
            j.push_str(&format!("{}", block[2 + i] as i8));
        }
        j.push_str("],\"values\":[");
        for i in 0..32 {
            if i > 0 {
                j.push(',');
            }
            j.push_str(&format!("{:.5}", scale * (block[2 + i] as i8) as f32));
        }
        j.push(']');
    }
    j.push('}');
    j
}

fn push_step(tok: &Tokenizer, rec: &mut Recorder, id: u32, shared: &Mutex<Shared>) {
    let mut st = shared.lock().unwrap();
    st.tokens.push((id, tok.decode(&[id])));
    st.steps.append(&mut rec.steps);
    st.seq += 1;
}

/// Park the cache and final logits for future forks/steps; mark idle.
fn finish(shared: &Mutex<Shared>, cache: KvCache, logits: Vec<f32>) {
    let mut st = shared.lock().unwrap();
    st.cache = Some(cache);
    st.last_logits = logits;
    st.busy = false;
    st.seq += 1;
}

/// inspect params: ?pos=<position>&layer=<layer>
fn parse_inspect(path: &str) -> (usize, usize) {
    let (mut pos, mut layer) = (usize::MAX, usize::MAX);
    if let Some(q) = path.split_once('?').map(|(_, q)| q) {
        for kv in q.split('&') {
            let Some((k, v)) = kv.split_once('=') else { continue };
            match k {
                "pos" => pos = v.parse().unwrap_or(usize::MAX),
                "layer" => layer = v.parse().unwrap_or(usize::MAX),
                _ => {}
            }
        }
    }
    (pos, layer)
}

/// fork params: ?pos=<tokens to keep>&token=<forced id>
fn parse_fork(path: &str) -> (usize, u32) {
    let (mut pos, mut token) = (0usize, u32::MAX);
    if let Some(q) = path.split_once('?').map(|(_, q)| q) {
        for kv in q.split('&') {
            let Some((k, v)) = kv.split_once('=') else { continue };
            match k {
                "pos" => pos = v.parse().unwrap_or(0),
                "token" => token = v.parse().unwrap_or(u32::MAX),
                _ => {}
            }
        }
    }
    (pos, token)
}

/// neighbors params: ?id=<token id>&n=<count> (n defaults to 12)
fn parse_neighbors(path: &str) -> (u32, usize) {
    let (mut id, mut n) = (u32::MAX, 12usize);
    if let Some(q) = path.split_once('?').map(|(_, q)| q) {
        for kv in q.split('&') {
            let Some((k, v)) = kv.split_once('=') else { continue };
            match k {
                "id" => id = v.parse().unwrap_or(u32::MAX),
                "n" => n = v.parse().unwrap_or(n),
                _ => {}
            }
        }
    }
    (id, n)
}

fn parse_params(path: &str) -> Params {
    let mut p = Params {
        n: 32,
        temp: 0.0,
        top_k: 40,
        top_p: 0.95,
        seed: 7,
        chat: false,
        backend: Backend::F32,
    };
    if let Some(q) = path.split_once('?').map(|(_, q)| q) {
        for kv in q.split('&') {
            let Some((k, v)) = kv.split_once('=') else { continue };
            match k {
                "n" => p.n = v.parse().unwrap_or(p.n).min(512),
                "temp" => p.temp = v.parse().unwrap_or(p.temp),
                "top_k" => p.top_k = v.parse().unwrap_or(p.top_k),
                "top_p" => p.top_p = v.parse().unwrap_or(p.top_p),
                "seed" => p.seed = v.parse().unwrap_or(p.seed),
                "chat" => p.chat = v == "1",
                "backend" => p.backend = Backend::parse(v),
                _ => {}
            }
        }
    }
    p
}

/// Read one HTTP request: (method, path, body). Good enough for localhost.
fn read_request(s: &mut TcpStream) -> Option<(String, String, Vec<u8>)> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        let n = s.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = find_header_end(&buf) {
            break i;
        }
        if buf.len() > 1 << 20 {
            return None;
        }
    };

    let head = String::from_utf8_lossy(&buf[..header_end]).into_owned();
    let mut lines = head.lines();
    let mut req = lines.next()?.split_whitespace();
    let method = req.next()?.to_string();
    let path = req.next()?.to_string();

    let content_len: usize = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.trim().parse().ok())
        .unwrap_or(0);

    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < content_len {
        let n = s.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_len);
    Some((method, path, body))
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}
