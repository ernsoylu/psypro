//! The calculation backend: frees.
//!
//! PsyPro does not implement psychrometrics. Every property here is answered by
//! `frees_core::props::propfun::ha_props_si`, the CoolProp `HAPropsSI`
//! signature, backed by rustprop — a pure-Rust port of CoolProp 8.0.0 that frees
//! grades in CI against 912 reference points.
//!
//! This module is the only place that knows frees exists. It owns two things the
//! rest of the crate should not have to think about:
//!
//! * **Installation.** `propfun`'s backend is process-global, so it is installed
//!   once, idempotently, on first use.
//! * **Units.** frees speaks SI base units — kelvin, pascals, J/kg. This crate's
//!   public API speaks the units an engineer reads: °C, kJ/kg. The conversion
//!   happens here and nowhere else.

use frees_core::props::propfun;
use frees_core::props::rustprop_backend::RustpropBackend;
use std::sync::{Arc, Once};

/// Absolute zero offset, °C to K.
const KELVIN: f64 = 273.15;

static INSTALL: Once = Once::new();

/// Installs the frees property backend, once per process.
fn ensure_backend() {
    INSTALL.call_once(|| {
        if propfun::backend().is_none() {
            propfun::install(Arc::new(RustpropBackend));
        }
    });
}

/// A humid-air property query that could not be answered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropertyError(String);

impl std::fmt::Display for PropertyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for PropertyError {}

impl PropertyError {
    /// The backend's own message.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.0
    }

    /// An error raised by this crate rather than by the backend.
    ///
    /// Used for states the backend will answer but that are not moist air —
    /// supersaturation being the one that matters, since `HAPropsSI` computes a
    /// humidity ratio from a dew point without reference to the dry bulb.
    #[must_use]
    pub fn supersaturated(message: String) -> Self {
        Self(message)
    }
}

/// One `HAPropsSI` call: `output` given three named inputs, all SI base units.
fn ha(
    output: &str,
    n1: &str,
    v1: f64,
    n2: &str,
    v2: f64,
    n3: &str,
    v3: f64,
) -> Result<f64, PropertyError> {
    ensure_backend();
    propfun::ha_props_si(output, n1, v1, n2, v2, n3, v3)
        .map_err(|e| PropertyError(e.to_string_message()))
}

/// Humidity ratio at saturation for a temperature, kg_wv/kg_da.
pub fn saturation_humidity_ratio(t_c: f64, p_bar: f64) -> Result<f64, PropertyError> {
    ha("W", "T", t_c + KELVIN, "R", 1.0, "P", p_bar)
}

/// Humidity ratio from dry-bulb temperature and relative humidity fraction.
pub fn humidity_ratio_from_rh(t_c: f64, rh: f64, p_bar: f64) -> Result<f64, PropertyError> {
    ha("W", "T", t_c + KELVIN, "R", rh, "P", p_bar)
}

/// Humidity ratio from dry-bulb and thermodynamic wet-bulb temperatures.
pub fn humidity_ratio_from_wet_bulb(
    t_db_c: f64,
    t_wb_c: f64,
    p_bar: f64,
) -> Result<f64, PropertyError> {
    ha("W", "T", t_db_c + KELVIN, "B", t_wb_c + KELVIN, "P", p_bar)
}

/// Humidity ratio from dry-bulb temperature and dew point.
pub fn humidity_ratio_from_dew_point(
    t_db_c: f64,
    t_dp_c: f64,
    p_bar: f64,
) -> Result<f64, PropertyError> {
    ha("W", "T", t_db_c + KELVIN, "D", t_dp_c + KELVIN, "P", p_bar)
}

/// Humidity ratio from dry-bulb temperature and specific enthalpy (kJ/kg_da).
pub fn humidity_ratio_from_enthalpy(t_db_c: f64, h: f64, p_bar: f64) -> Result<f64, PropertyError> {
    ha("W", "T", t_db_c + KELVIN, "H", h * 1000.0, "P", p_bar)
}

/// Specific enthalpy, kJ/kg_da.
pub fn enthalpy(t_c: f64, w: f64, p_bar: f64) -> Result<f64, PropertyError> {
    ha("H", "T", t_c + KELVIN, "W", w, "P", p_bar).map(|j| j / 1000.0)
}

/// Thermodynamic wet-bulb temperature, °C.
pub fn wet_bulb(t_c: f64, w: f64, p_bar: f64) -> Result<f64, PropertyError> {
    ha("B", "T", t_c + KELVIN, "W", w, "P", p_bar).map(|k| k - KELVIN)
}

/// Dew-point temperature, °C.
pub fn dew_point(t_c: f64, w: f64, p_bar: f64) -> Result<f64, PropertyError> {
    ha("D", "T", t_c + KELVIN, "W", w, "P", p_bar).map(|k| k - KELVIN)
}

/// Relative humidity as a fraction.
pub fn relative_humidity(t_c: f64, w: f64, p_bar: f64) -> Result<f64, PropertyError> {
    ha("R", "T", t_c + KELVIN, "W", w, "P", p_bar)
}

/// Specific volume per unit mass of dry air, m³/kg_da.
pub fn specific_volume(t_c: f64, w: f64, p_bar: f64) -> Result<f64, PropertyError> {
    ha("V", "T", t_c + KELVIN, "W", w, "P", p_bar)
}

/// Dry-bulb temperature from specific enthalpy and humidity ratio, °C.
pub fn temperature_from_enthalpy(h: f64, w: f64, p_bar: f64) -> Result<f64, PropertyError> {
    ha("T", "H", h * 1000.0, "W", w, "P", p_bar).map(|k| k - KELVIN)
}

/// A description of the installed backend, for provenance in reports.
#[must_use]
pub fn description() -> String {
    ensure_backend();
    propfun::backend_description()
}
