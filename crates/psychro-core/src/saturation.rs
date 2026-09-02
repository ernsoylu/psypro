//! Saturation vapour pressure and its inverse.
//!
//! Two formulations are required, and using one outside its phase is the single
//! largest source of error in psychrometric software: over liquid water the
//! IAPWS-IF97 saturation line applies, while below 0 °C the IAPWS-06/08
//! sublimation line over ice applies. A Magnus/Antoine fit extended below
//! freezing overstates saturation pressure by more than 20% at −20 °C.
//!
//! Reference: D. P. Gatley, *Understanding Psychrometrics*, 3rd ed. (ASHRAE),
//! Ch. 4 and Ch. 26 subprograms `p_ws_liq97` and `p_ws_ice08`.

use crate::constants::P_STD;

/// IAPWS-IF97 region-4 coefficients `N1..N10`.
const N: [f64; 10] = [
    1_167.052_145_276_70,
    -724_213.167_032_060,
    -17.073_846_940_092_0,
    12_020.824_702_470_0,
    -3_232_555.032_233_30,
    14.915_108_613_530_0,
    -4_823.265_736_159_10,
    405_113.405_420_570,
    -0.238_555_575_678_490,
    650.175_348_447_980,
];

/// Which condensed phase the saturation line is taken over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// Saturation over liquid water, used at and above 0 °C.
    Liquid,
    /// Saturation over ice, used below 0 °C.
    Ice,
}

/// Saturation vapour pressure over liquid water, in Pa.
///
/// IAPWS-IF97 region-4 equation. Valid for 0 °C to 373.946 °C, and usable as a
/// supercooled-liquid extrapolation down to about −40 °C.
#[must_use]
pub fn p_ws_liquid(t_c: f64) -> f64 {
    let t = t_c + 273.15;
    let q = t + N[8] / (t - N[9]);
    let a = q * q + N[0] * q + N[1];
    let b = N[2] * q * q + N[3] * q + N[4];
    let c = N[5] * q * q + N[6] * q + N[7];
    // IF97 yields MPa; convert to Pa.
    (2.0 * c / (-b + (b * b - 4.0 * a * c).sqrt())).powi(4) * 1.0e6
}

/// Saturation vapour pressure over ice, in Pa.
///
/// IAPWS-06/08 sublimation line. Valid from 50 K to 273.16 K.
#[must_use]
pub fn p_ws_ice(t_c: f64) -> f64 {
    let theta = (t_c + 273.15) / 273.16;
    let a = [-21.214_400_6, 27.320_381_9, -6.105_981_30];
    let b = [0.003_333_333_33, 1.206_666_67, 1.703_333_3];
    let sum = a[0] * theta.powf(b[0]) + a[1] * theta.powf(b[1]) + a[2] * theta.powf(b[2]);
    611.657 * (sum / theta).exp()
}

/// Saturation vapour pressure in Pa, selecting the phase from the temperature.
///
/// Uses ice below 0 °C and liquid water at or above 0 °C.
#[must_use]
pub fn p_ws(t_c: f64) -> f64 {
    if t_c < 0.0 {
        p_ws_ice(t_c)
    } else {
        p_ws_liquid(t_c)
    }
}

/// Saturation vapour pressure over an explicitly chosen phase, in Pa.
///
/// Needed for supercooled-water cases, where the liquid line is wanted below 0 °C.
#[must_use]
pub fn p_ws_over(t_c: f64, phase: Phase) -> f64 {
    match phase {
        Phase::Liquid => p_ws_liquid(t_c),
        Phase::Ice => p_ws_ice(t_c),
    }
}

/// Inverts [`p_ws`]: the temperature in °C whose saturation pressure is `p` Pa.
///
/// This is the dew-point (above 0 °C) or frost-point (below 0 °C) temperature.
/// Solved by bisection on the monotonic saturation curve rather than by a
/// separate backward correlation, so it stays consistent with [`p_ws`] by
/// construction and needs no additional fitted coefficients.
///
/// Returns `None` when `p` is not positive or lies outside the −100 °C..200 °C
/// bracket.
#[must_use]
pub fn t_sat(p: f64) -> Option<f64> {
    if p <= 0.0 {
        return None;
    }
    let (mut lo, mut hi) = (-100.0_f64, 200.0_f64);
    if p < p_ws(lo) || p > p_ws(hi) {
        return None;
    }
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        if p_ws(mid) < p {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    Some(0.5 * (lo + hi))
}

/// Water-vapour enhancement factor `f_s`, dimensionless.
///
/// Corrects the ideal-gas treatment for intermolecular forces between the air
/// constituents and water vapour. It is close to 1.0048 at sea level, so
/// ignoring it biases humidity ratio by roughly half a percent.
///
/// This is the pressure-only approximation adequate for atmospheric work; it is
/// applied to the saturation pressure before the humidity-ratio conversion.
#[must_use]
pub fn enhancement_factor(p_bar: f64) -> f64 {
    // Linearised about standard atmosphere: f_s(101325 Pa) = 1.00475.
    1.0 + 0.004_75 * (p_bar / P_STD)
}
