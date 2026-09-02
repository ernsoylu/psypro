//! Physical constants for moist-air psychrometrics.
//!
//! Values follow ASHRAE Research Project RP-1485 as tabulated in D. P. Gatley,
//! *Understanding Psychrometrics*, 3rd ed. (ASHRAE). They are deliberately kept
//! in one place: older textbook constants (notably `2501` and `1.86` for the
//! water-vapour enthalpy reference and specific heat) are still in wide
//! circulation and silently shift every derived property by ~0.25%.

/// Molar mass of dry air, kg/kmol.
pub const M_DA: f64 = 28.966;

/// Molar mass of water vapour, kg/kmol.
pub const M_WV: f64 = 18.015_268;

/// Ratio of molar masses, `M_WV / M_DA`. Appears in every humidity-ratio conversion.
pub const MASS_RATIO: f64 = 0.621_945;

/// Reciprocal mass ratio, `M_DA / M_WV`. Used in the specific-volume relation.
pub const MASS_RATIO_INV: f64 = 1.607_858;

/// Universal gas constant, J/(kmol·K).
pub const R_UNIVERSAL: f64 = 8_314.472;

/// Specific gas constant of dry air, J/(kg_da·K).
pub const R_DA: f64 = 287.042;

/// Specific gas constant of water vapour, J/(kg_wv·K).
pub const R_WV: f64 = 461.524;

/// Specific heat of dry air, kJ/(kg_da·K).
pub const CP_DA: f64 = 1.006;

/// Specific heat of water vapour, kJ/(kg_wv·K).
///
/// RP-1485 curve fit over −15 °C to 30 °C. Note this is `1.84`, not the `1.86`
/// found in many textbooks.
pub const CP_WV: f64 = 1.84;

/// Specific heat of liquid water, kJ/(kg·K).
pub const CP_LIQUID: f64 = 4.186;

/// Specific heat of ice, kJ/(kg·K).
pub const CP_ICE: f64 = 2.0;

/// Enthalpy of saturated water vapour at 0 °C, kJ/kg_wv.
///
/// RP-1485 value. Note this is `2499.86`, not the `2501` of older tables.
pub const H_G_REF: f64 = 2_499.86;

/// Reference enthalpy used by the sub-freezing wet-bulb relation, kJ/kg.
pub const H_G_REF_ICE: f64 = 2_833.28;

/// One standard atmosphere, Pa.
pub const P_STD: f64 = 101_325.0;
