//! Conversions between SI and IP (Imperial) engineering units.
//!
//! The engine computes exclusively in SI. Unit choice is a presentation concern
//! handled at the boundary: inputs are converted in, results converted out. That
//! keeps a single code path through the thermodynamics, so an IP result can
//! never disagree with its SI equivalent by more than float rounding.

/// Kelvin/Celsius degree size relative to Rankine/Fahrenheit.
const F_PER_C: f64 = 1.8;

/// 1 Btu/lb equals this many kJ/kg.
pub const BTU_PER_LB_TO_KJ_PER_KG: f64 = 2.326;

/// 1 ft³/lb equals this many m³/kg.
pub const FT3_PER_LB_TO_M3_PER_KG: f64 = 0.062_428;

/// 1 lb/ft³ equals this many kg/m³.
pub const LB_PER_FT3_TO_KG_PER_M3: f64 = 16.018_463;

/// 1 psi equals this many pascals.
pub const PSI_TO_PA: f64 = 6_894.757_293_168_36;

/// 1 foot equals this many metres.
pub const FT_TO_M: f64 = 0.3048;

/// Fahrenheit to Celsius.
#[must_use]
pub fn f_to_c(t_f: f64) -> f64 {
    (t_f - 32.0) / F_PER_C
}

/// Celsius to Fahrenheit.
#[must_use]
pub fn c_to_f(t_c: f64) -> f64 {
    t_c * F_PER_C + 32.0
}

/// A temperature *difference* in Fahrenheit/Rankine degrees to Kelvin.
///
/// Distinct from [`f_to_c`]: differences carry no offset, and conflating the two
/// is a routine source of wrong `Δt` values in load calculations.
#[must_use]
pub fn delta_f_to_k(d_f: f64) -> f64 {
    d_f / F_PER_C
}

/// A temperature difference in Kelvin to Fahrenheit/Rankine degrees.
#[must_use]
pub fn delta_k_to_f(d_k: f64) -> f64 {
    d_k * F_PER_C
}

/// Btu/lb_da to kJ/kg_da.
#[must_use]
pub fn btu_per_lb_to_kj_per_kg(h: f64) -> f64 {
    h * BTU_PER_LB_TO_KJ_PER_KG
}

/// kJ/kg_da to Btu/lb_da.
#[must_use]
pub fn kj_per_kg_to_btu_per_lb(h: f64) -> f64 {
    h / BTU_PER_LB_TO_KJ_PER_KG
}

/// ft³/lb_da to m³/kg_da.
#[must_use]
pub fn ft3_per_lb_to_m3_per_kg(v: f64) -> f64 {
    v * FT3_PER_LB_TO_M3_PER_KG
}

/// m³/kg_da to ft³/lb_da.
#[must_use]
pub fn m3_per_kg_to_ft3_per_lb(v: f64) -> f64 {
    v / FT3_PER_LB_TO_M3_PER_KG
}

/// kg/m³ to lb/ft³.
#[must_use]
pub fn kg_per_m3_to_lb_per_ft3(rho: f64) -> f64 {
    rho / LB_PER_FT3_TO_KG_PER_M3
}

/// Pascals to psi.
#[must_use]
pub fn pa_to_psi(p: f64) -> f64 {
    p / PSI_TO_PA
}

/// Feet to metres.
#[must_use]
pub fn ft_to_m(l: f64) -> f64 {
    l * FT_TO_M
}

/// Humidity ratio in grains of moisture per pound of dry air.
///
/// The customary IP presentation; 7000 grains make one pound.
#[must_use]
pub fn humidity_ratio_to_grains(w: f64) -> f64 {
    w * 7000.0
}
