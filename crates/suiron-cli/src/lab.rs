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

use suiron_core::{forward, KvCache, Model, Sampler, Tokenizer};

struct Shared {
    tokens: Vec<(u32, String)>,
    steps: Vec<Step>,
    n_prompt: usize,
    busy: bool,
    seq: u64,
    /// KV cache of the last completed run — kept so forks rewind instantly.
    cache: Option<KvCache>,
    /// (position, discarded tail text) of the most recent fork.
    fork: Option<(usize, String)>,
}

#[derive(Clone, Copy)]
struct Params {
    n: usize,
    temp: f32,
    top_k: usize,
    top_p: f32,
    seed: u64,
    chat: bool,
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
        fork: None,
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
                let json = write_trace(
                    &model_name,
                    "q8_0",
                    &model.config,
                    &st.tokens,
                    st.n_prompt,
                    &st.steps,
                    Some((st.busy, st.seq)),
                    st.fork.as_ref(),
                    |id| tok.decode(&[id]),
                );
                respond(&mut s, "200 OK", "application/json", json.as_bytes());
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
                        let mut deep = crate::machine::DeepObserver::new(layer);
                        forward(&model, &mut c, id, Some(&mut deep));
                        let text = tok.decode(&[id]);
                        let json = crate::machine::inspect_json(&deep, pos, (id, &text));
                        respond(&mut s, "200 OK", "application/json", json.as_bytes());
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
        logits = forward(model, &mut cache, t, Some(&mut rec));
        rec.record_logits(&logits, 10);
        push_step(tok, &mut rec, t, shared);
    }

    run_decode(model, tok, &mut rec, &mut cache, logits, p, shared, stop_flag, stop_ids);
    finish(shared, cache);
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
    let logits = forward(model, &mut cache, forced, Some(&mut rec));
    rec.record_logits(&logits, 10);
    rec.set_sel(sel);
    push_step(tok, &mut rec, forced, shared);

    run_decode(model, tok, &mut rec, &mut cache, logits, p, shared, stop_flag, stop_ids);
    finish(shared, cache);
}

/// The sampling loop shared by generate and fork.
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
) {
    let mut sampler = Sampler::new(p.temp, p.top_k, p.top_p, p.seed);
    for _ in 0..p.n {
        if stop_flag.load(Ordering::Relaxed) || logits.is_empty() {
            break;
        }
        let (id, sel) = sampler.sample_traced(&logits);
        if stop_ids.contains(&id) {
            break;
        }
        rec.begin_step();
        logits = forward(model, cache, id, Some(&mut *rec));
        rec.record_logits(&logits, 10);
        rec.set_sel(sel);
        push_step(tok, rec, id, shared);
    }
}

fn push_step(tok: &Tokenizer, rec: &mut Recorder, id: u32, shared: &Mutex<Shared>) {
    let mut st = shared.lock().unwrap();
    st.tokens.push((id, tok.decode(&[id])));
    st.steps.append(&mut rec.steps);
    st.seq += 1;
}

/// Park the cache for future forks and mark idle.
fn finish(shared: &Mutex<Shared>, cache: KvCache) {
    let mut st = shared.lock().unwrap();
    st.cache = Some(cache);
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

fn parse_params(path: &str) -> Params {
    let mut p = Params { n: 32, temp: 0.0, top_k: 40, top_p: 0.95, seed: 7, chat: false };
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
