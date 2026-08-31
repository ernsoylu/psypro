//! `wasm-bindgen` bridge exposing [`psychro_core`] to TypeScript.
//!
//! This crate contains no calculations of its own. Its only job is to translate
//! between Rust types and the JavaScript boundary, and to emit the TypeScript
//! definitions that the frontend consumes. Any thermodynamic logic added here
//! instead of in `psychro-core` is a bug: it would be unreachable from
//! `cargo test` and invisible to non-browser consumers.

#![deny(unsafe_code)]

use wasm_bindgen::prelude::*;

/// Returns the version of the underlying calculation engine.
///
/// Used by the frontend to confirm that the loaded WASM module matches the
/// build it expects, which is the usual cause of stale-artifact bugs.
#[wasm_bindgen]
pub fn engine_version() -> String {
    psychro_core::VERSION.to_string()
}
