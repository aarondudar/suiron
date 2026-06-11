//! suiron-core: tokenizer and CPU forward pass (M1).

pub mod forward;
pub mod generate;
pub mod math;
pub mod model;
pub mod sampling;
pub mod tokenizer;

pub use forward::{forward, prefill, KvCache};
pub use generate::generate;
pub use model::Model;
pub use sampling::Sampler;
pub use tokenizer::Tokenizer;
