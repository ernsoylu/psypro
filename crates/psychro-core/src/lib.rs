//! Psychrometric calculations for PsyPro.
//!
//! This crate holds every thermodynamic and chart-geometry calculation in the
//! project. It is deliberately free of WASM, browser, and UI concerns so that it
//! can be tested headlessly with `cargo test` and reused outside the web app.
//!
//! The public API is stateless: unit system and altitude are passed in with each
//! call rather than held as ambient configuration. See `DEVELOPMENT_PLAN.md`
//! Phase 1 for the API this crate will grow.

#![deny(unsafe_code)]

pub mod backend;
pub mod chart;
pub mod coil;
pub mod constants;
pub mod envelope;
pub mod explain;
pub mod identify;
pub mod process;
pub mod saturation;
pub mod state;
pub mod units;
pub mod weather;

pub use state::StatePoint;

/// The semantic version of this crate, surfaced so the UI can report which
/// engine build produced a set of results.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_populated() {
        assert!(!VERSION.is_empty());
    }
}
