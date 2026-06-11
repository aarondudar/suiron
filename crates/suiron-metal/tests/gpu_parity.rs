//! GPU vs CPU forward-pass parity on the real model. Skips if not present.

use suiron_core::{forward, KvCache, Model};
use suiron_gguf::GgufFile;

const MODEL: &str = "../../models/Qwen3-0.6B-Q8_0.gguf";

#[test]
fn gpu_forward_matches_cpu() {
    if !std::path::Path::new(MODEL).exists() {
        eprintln!("skipping: {MODEL} not present");
        return;
    }
    let file = GgufFile::open(MODEL).expect("parse");
    let model = Model::load(&file).expect("load");
    let gpu = suiron_metal::GpuModel::new(&model).expect("gpu init");

    let prompt = [1782u32, 8251, 7578, 389, 279]; // "the cat sat on the"
    let mut cpu_cache = KvCache::new(&model);
    let mut gpu_cache = KvCache::new(&model);

    let mut max_diff = 0.0f32;
    for &t in &prompt {
        let a = forward(&model, &mut cpu_cache, t, None);
        let b = gpu.forward(&mut gpu_cache, t);
        for (x, y) in a.iter().zip(&b) {
            max_diff = max_diff.max((x - y).abs());
        }
        // greedy choice must agree at every step
        assert_eq!(
            suiron_core::sampling::argmax(&a),
            suiron_core::sampling::argmax(&b),
            "argmax diverged"
        );
    }
    eprintln!("max |cpu - gpu| logit diff over prompt: {max_diff}");
    assert!(max_diff < 2e-2, "logit divergence too large: {max_diff}");
}
