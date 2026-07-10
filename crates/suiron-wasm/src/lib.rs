//! suiron in the browser. The same engine (`forward`, the samplers, the
//! tokenizer) and the same serialization (`suiron_cli::{trace, machine}`)
//! called in-process, so the static lab serves byte-identical JSON shapes to
//! the ones the native server emits — the web frontend cannot tell the
//! difference.
//!
//! Loads models **lean** (`Model::load_lean`): a Q8_0 file stays resident as
//! its quantized blocks (~640 MB for Qwen3-0.6B) instead of ~2.4 GB of f32,
//! and all compute runs on the Q8 backend, which native tests pin
//! argmax-identical to f32.
//!
//! Generation is pump-driven: `start_generate`/`step_more`/`fork_to` queue
//! work, and the JS host calls `pump()` once per tick (one token of work per
//! call) so the UI thread stays alive and `stop()` works between tokens.

use std::cell::RefCell;

use suiron_cli::chat::chat_prompt;
use suiron_cli::machine;
use suiron_cli::trace::{write_trace, Live, Recorder, Shadow, Step};
use suiron_core::sampling::{Cand, SampleTrace};
use suiron_core::{forward, Backend, KvCache, Model, Sampler, Tokenizer};
use wasm_bindgen::prelude::*;

/// What the pump should do next. One token of work per `pump()` call.
enum Work {
    Idle,
    /// Prefill the prompt: ids to feed, next index.
    Prefill { ids: Vec<u32>, at: usize, then_decode: usize },
    /// Sample-and-forward `left` more tokens.
    Decode { left: usize },
}

struct Lab {
    model: Model,
    tok: Tokenizer,
    model_name: String,
    quant: &'static str,
    stop_ids: Vec<u32>,

    tokens: Vec<(u32, String)>,
    steps: Vec<Step>,
    n_prompt: usize,
    seq: u64,
    cache: KvCache,
    last_logits: Vec<f32>,
    /// the most recent fork's shadow (docs/22): the replaced run's tail
    fork: Option<Shadow>,
    sampler: Option<Sampler>,
    work: Work,

    /// decode tok/s measured over this session's forwards (Date.now-based).
    fwd_ms: f64,
    fwd_n: u32,
}

thread_local! {
    static LAB: RefCell<Option<Lab>> = const { RefCell::new(None) };
}

fn with_lab<T>(f: impl FnOnce(&mut Lab) -> Result<T, String>) -> Result<T, JsError> {
    LAB.with(|l| {
        let mut l = l.borrow_mut();
        let lab = l.as_mut().ok_or("no model loaded")?;
        f(lab)
    })
    .map_err(|e: String| JsError::new(&e))
}

/// Parse the GGUF bytes, build the tokenizer, and load the model lean.
/// One-time; the bytes can be dropped by the caller afterwards.
#[wasm_bindgen]
pub fn load_model(bytes: Vec<u8>) -> Result<(), JsError> {
    let file = suiron_gguf::GgufFile::from_bytes(bytes).map_err(|e| JsError::new(&e.to_string()))?;
    let tok = Tokenizer::from_gguf(&file).map_err(|e| JsError::new(&e))?;
    let model = Model::load_lean(&file).map_err(|e| JsError::new(&e))?;
    let model_name = file.get_str("general.name").unwrap_or("qwen3").to_string();
    let quant = if model.layers[0].wq.q8.is_some() { "q8_0" } else { "f32" };
    let stop_ids: Vec<u32> = [
        file.get_u64("tokenizer.ggml.eos_token_id").map(|v| v as u32),
        tok.token_id("<|endoftext|>"),
    ]
    .into_iter()
    .flatten()
    .collect();

    let cache = KvCache::new(&model);
    LAB.with(|l| {
        *l.borrow_mut() = Some(Lab {
            model,
            tok,
            model_name,
            quant,
            stop_ids,
            tokens: Vec::new(),
            steps: Vec::new(),
            n_prompt: 0,
            seq: 0,
            cache,
            last_logits: Vec::new(),
            fork: None,
            sampler: None,
            work: Work::Idle,
            fwd_ms: 0.0,
            fwd_n: 0,
        });
    });
    Ok(())
}

/// Begin a fresh run: reset the resident state, queue the prompt's prefill and
/// `n` decode tokens. Drive with `pump()`.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn start_generate(
    prompt: &str,
    n: usize,
    temp: f32,
    top_k: usize,
    top_p: f32,
    seed: u64,
    chat: bool,
) -> Result<(), JsError> {
    with_lab(|lab| {
        let ids = if chat {
            chat_prompt(&lab.tok, prompt).unwrap_or_else(|_| lab.tok.encode(prompt))
        } else {
            lab.tok.encode(prompt)
        };
        if ids.is_empty() {
            return Err("empty prompt".into());
        }
        lab.tokens.clear();
        lab.steps.clear();
        lab.cache = KvCache::new(&lab.model);
        lab.last_logits.clear();
        lab.fork = None;
        lab.n_prompt = ids.len();
        lab.sampler = Some(Sampler::new(temp, top_k, top_p, seed));
        lab.work = Work::Prefill { ids, at: 0, then_decode: n };
        lab.seq += 1;
        Ok(())
    })
}

/// Continue `n` more tokens from the resident state (the lab's `step`).
#[wasm_bindgen]
pub fn step_more(n: usize, temp: f32, top_k: usize, top_p: f32, seed: u64) -> Result<(), JsError> {
    with_lab(|lab| {
        if lab.last_logits.is_empty() {
            return Err("nothing to continue — generate first".into());
        }
        lab.sampler = Some(Sampler::new(temp, top_k, top_p, seed));
        lab.work = Work::Decode { left: n };
        lab.seq += 1;
        Ok(())
    })
}

/// Counterfactual fork: keep tokens [0, pos), force `token` at pos, continue
/// `n` tokens. Mirrors the native lab's fork semantics (the forced token's
/// selection trace records the model's own prediction at that point).
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn fork_to(
    pos: usize,
    token: u32,
    n: usize,
    temp: f32,
    top_k: usize,
    top_p: f32,
    seed: u64,
) -> Result<(), JsError> {
    with_lab(|lab| {
        if pos == 0 || pos > lab.tokens.len() {
            return Err("bad fork position".into());
        }
        // the model's own top predictions at the fork point, for the sel trace
        let model_top: Vec<(u32, f32)> = lab.steps[pos - 1].top.clone();
        // the discarded tail moves into the shadow (docs/22); prefix stays resident
        lab.fork = Some(Shadow::capture(pos, &mut lab.tokens, &mut lab.steps, lab.n_prompt));
        lab.cache.truncate(pos);
        lab.n_prompt = lab.n_prompt.min(pos); // forking inside the prompt makes the rest generated

        let mut cand: Vec<Cand> = model_top
            .iter()
            .map(|&(id, prob)| Cand {
                id,
                logit: 0.0,
                p: prob,
                p_final: if id == token { 1.0 } else { 0.0 },
                cut: None,
            })
            .collect();
        if !cand.iter().any(|c| c.id == token) {
            cand.push(Cand { id: token, logit: 0.0, p: 0.0, p_final: 1.0, cut: None });
        }
        let sel = SampleTrace {
            temperature: temp,
            top_k,
            top_p,
            seed,
            r: None,
            chosen: token,
            forced: true,
            cand,
        };

        let mut rec = Recorder::new(6);
        rec.begin_step();
        lab.last_logits = forward(&lab.model, &mut lab.cache, token, Backend::Q8, Some(&mut rec));
        rec.record_logits(&lab.last_logits, 10);
        rec.set_sel(sel);
        lab.tokens.push((token, lab.tok.decode(&[token])));
        lab.steps.append(&mut rec.steps);

        lab.sampler = Some(Sampler::new(temp, top_k, top_p, seed));
        lab.work = Work::Decode { left: n };
        lab.seq += 1;
        Ok(())
    })
}

/// One token of work (a prefill position or a sampled decode step). Returns
/// true while more work remains — the JS host loops with setTimeout so the UI
/// breathes between tokens and `stop()` can land.
#[wasm_bindgen]
pub fn pump() -> Result<bool, JsError> {
    with_lab(|lab| {
        let t0 = js_sys::Date::now();
        match std::mem::replace(&mut lab.work, Work::Idle) {
            Work::Idle => return Ok(false),
            Work::Prefill { ids, at, then_decode } => {
                let mut rec = Recorder::new(6);
                rec.begin_step();
                let id = ids[at];
                lab.last_logits =
                    forward(&lab.model, &mut lab.cache, id, Backend::Q8, Some(&mut rec));
                rec.record_logits(&lab.last_logits, 10);
                lab.tokens.push((id, lab.tok.decode(&[id])));
                lab.steps.append(&mut rec.steps);
                lab.work = if at + 1 < ids.len() {
                    Work::Prefill { ids, at: at + 1, then_decode }
                } else {
                    Work::Decode { left: then_decode }
                };
            }
            Work::Decode { left } => {
                if left == 0 || lab.last_logits.is_empty() {
                    lab.seq += 1;
                    return Ok(false);
                }
                let sampler = lab.sampler.as_mut().ok_or("no sampler")?;
                let (id, sel) = sampler.sample_traced(&lab.last_logits);
                if lab.stop_ids.contains(&id) {
                    lab.seq += 1;
                    return Ok(false);
                }
                let mut rec = Recorder::new(6);
                rec.begin_step();
                lab.last_logits =
                    forward(&lab.model, &mut lab.cache, id, Backend::Q8, Some(&mut rec));
                rec.record_logits(&lab.last_logits, 10);
                rec.set_sel(sel);
                lab.tokens.push((id, lab.tok.decode(&[id])));
                lab.steps.append(&mut rec.steps);
                lab.fwd_ms += js_sys::Date::now() - t0;
                lab.fwd_n += 1;
                lab.work = Work::Decode { left: left - 1 };
            }
        }
        lab.seq += 1;
        Ok(!matches!(lab.work, Work::Idle))
    })
}

/// Abandon any queued work (the lab's `stop`).
#[wasm_bindgen]
pub fn stop() -> Result<(), JsError> {
    with_lab(|lab| {
        lab.work = Work::Idle;
        lab.seq += 1;
        Ok(())
    })
}

/// The resident trace, exactly the native `/api/v1/trace` shape.
#[wasm_bindgen]
pub fn trace_json() -> Result<String, JsError> {
    with_lab(|lab| {
        let live = Live {
            busy: !matches!(lab.work, Work::Idle),
            seq: lab.seq,
            backend: "q8",
            tps_f32: None,
            tps_q8: (lab.fwd_n > 0).then(|| lab.fwd_n as f64 / (lab.fwd_ms / 1000.0).max(1e-9)),
        };
        Ok(write_trace(
            &lab.model_name,
            lab.quant,
            &lab.model.config,
            &lab.tokens,
            lab.n_prompt,
            &lab.steps,
            Some(&live),
            lab.fork.as_ref(),
            |id| lab.tok.decode(&[id]),
        ))
    })
}

/// Deep inspection of one (pos, layer), `/api/v1/inspect` shape. `head`/`src`
/// are -1 when absent. Recomputes over a cloned cache, exactly like the native
/// handler (here on the Q8 backend the whole build runs on).
#[wasm_bindgen]
pub fn inspect_json(pos: usize, layer: usize, head: i32, src: i32) -> Result<String, JsError> {
    with_lab(|lab| {
        if pos >= lab.tokens.len() || layer > lab.model.config.n_layers {
            return Err("bad pos/layer".into());
        }
        let mut c = lab.cache.clone();
        c.truncate(pos);
        let id = lab.tokens[pos].0;
        let mut deep = machine::DeepObserver::new(layer);
        forward(&lab.model, &mut c, id, Backend::Q8, Some(&mut deep));
        let worked = (head >= 0)
            .then(|| {
                machine::worked_dot(
                    &deep,
                    &c,
                    head as usize,
                    (src >= 0).then_some(src as usize),
                    pos,
                    &lab.model.config,
                )
            })
            .flatten();
        let norm = (layer < lab.model.config.n_layers)
            .then(|| {
                machine::worked_norm(
                    &deep,
                    &lab.model.layers[layer].attn_norm.data,
                    lab.model.config.rms_eps,
                    8,
                )
            })
            .flatten();
        let unembed = (layer == lab.model.config.n_layers)
            .then(|| machine::worked_unembed(&deep, &lab.model, 4))
            .flatten();
        let text = lab.tok.decode(&[id]);
        Ok(machine::inspect_json(&deep, pos, (id, &text), worked.as_ref(), norm.as_ref(), unembed.as_ref()))
    })
}

/// Per-layer logit lens for one position, `/api/v1/lens` shape.
#[wasm_bindgen]
pub fn lens_json(pos: usize, k: usize) -> Result<String, JsError> {
    with_lab(|lab| {
        if pos >= lab.tokens.len() {
            return Err("bad pos".into());
        }
        let mut c = lab.cache.clone();
        c.truncate(pos);
        let id = lab.tokens[pos].0;
        let mut obs = machine::LensObserver::default();
        forward(&lab.model, &mut c, id, Backend::Q8, Some(&mut obs));
        Ok(machine::lens_json(&lab.model, &obs.residuals, pos, k.clamp(1, 10), |t| {
            lab.tok.decode(&[t])
        }))
    })
}

/// Cosine neighbors of a token, `/api/v1/neighbors` shape.
#[wasm_bindgen]
pub fn neighbors_json(id: u32, n: usize) -> Result<String, JsError> {
    with_lab(|lab| {
        if id as usize >= lab.model.config.vocab {
            return Err("bad id".into());
        }
        Ok(machine::neighbors_json(&lab.model, id, n, |t| lab.tok.decode(&[t])))
    })
}

/// BPE merge trace of the resident prompt, `/api/v1/merges` shape.
#[wasm_bindgen]
pub fn merges_json() -> Result<String, JsError> {
    with_lab(|lab| {
        let ids: Vec<u32> = lab.tokens[..lab.n_prompt].iter().map(|&(id, _)| id).collect();
        let text = lab.tok.decode(&ids);
        Ok(machine::merges_json(&lab.tok.encode_merges(&text)))
    })
}

/// One real Q8_0 block, `/api/v1/quant-sample` shape.
#[wasm_bindgen]
pub fn quant_sample_json() -> Result<String, JsError> {
    with_lab(|lab| Ok(machine::quant_sample_json(&lab.model)))
}

/// The engine's own source for a named piece, `/api/v1/source` (plain text).
#[wasm_bindgen]
pub fn source_text(name: &str) -> Option<String> {
    machine::source_for(name)
}
