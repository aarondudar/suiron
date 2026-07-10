//! The shareable half of the `suiron` package: trace recording/serialization,
//! the deep-inspection ("machine") layer, and chat prompt assembly. Consumed by
//! the native binary (src/main.rs — the lab server, run, view, …) and by the
//! WASM build (`suiron-wasm`), which calls the exact same functions in-process
//! so the browser serves byte-identical JSON shapes. std only.

pub mod chat;
pub mod machine;
pub mod trace;
