//! Show the working.
//!
//! `REQUIREMENTS.md` §11: any computed property expands to reveal the equation,
//! the substituted values, and the reference it comes from. This module produces
//! that, and it lives in the engine for a reason that is not organisational:
//! **only the engine knows what was substituted.**
//!
//! A "show the working" panel written in the view would have to re-derive the
//! intermediate quantities to display them, which means a second implementation
//! of the same physics — the exact divergence the architecture rule exists to
//! prevent, and the worst possible place for it, because it would be teaching.
//!
//! # What is explained, and what is not
//!
//! The definitional relations are: the ones a student is expected to be able to
//! reproduce, and the ones whose constants are worth naming. The *correlations*
//! are not — IAPWS-IF97 saturation pressure is a fifteen-term fit and printing
//! it teaches nothing. Those get a citation instead, which is the honest form of
//! "look it up".

use crate::constants::{CP_DA, CP_WV, H_G_REF, MASS_RATIO, R_DA};
use crate::state::StatePoint;

/// One step of the working.
#[derive(Debug, Clone)]
pub struct Step {
    /// Which property this derives, matching the panel's own key.
    pub property: &'static str,
    /// The relation, in symbols.
    pub equation: &'static str,
    /// The same relation with this state's numbers in it.
    pub substitution: String,
    /// The result, formatted with the property's own precision.
    pub result: String,
    /// Where the relation and its constants come from.
    pub reference: &'static str,
    /// What a reader most often gets wrong here, or `None`.
    ///
    /// §11's second requirement: *name the trap*. Where a quantity is routinely
    /// confused with another, saying so beside the number is worth more than the
    /// number.
    pub caution: Option<&'static str>,
}

/// Formats a number without a trailing run of zeros.
fn n(value: f64, decimals: usize) -> String {
    format!("{value:.decimals$}")
}

/// The working behind a resolved state, in the order a derivation runs.
#[must_use]
pub fn explain(state: &StatePoint) -> Vec<Step> {
    let p = state.atm.p_bar;
    let p_ws = if state.rh > 0.0 {
        state.p_wv / state.rh
    } else {
        crate::saturation::p_ws(state.t_db)
    };
    let w_s = if state.mu > 0.0 {
        state.w / state.mu
    } else {
        0.0
    };

    vec![
        Step {
            property: "p_ws",
            equation: "p_ws = f(t)   — IAPWS-IF97 over water, IAPWS-06 over ice",
            substitution: format!(
                "p_ws({} °C) = {} Pa   [{} branch]",
                n(state.t_db, 2),
                n(p_ws, 2),
                if state.t_db < 0.0 { "ice" } else { "water" }
            ),
            result: format!("{} Pa", n(p_ws, 2)),
            reference: "IAPWS-IF97 (water) and IAPWS-06/08 (ice); ASHRAE RP-1485",
            caution: Some(
                "A single Magnus fit is wrong by over 20% at −20 °C because it has no ice \
                 branch. Below freezing the saturation line is over ice, not water.",
            ),
        },
        Step {
            property: "p_wv",
            equation: "φ = p_wv / p_ws",
            substitution: format!(
                "{} = {} Pa / {} Pa",
                n(state.rh, 4),
                n(state.p_wv, 2),
                n(p_ws, 2)
            ),
            result: format!("{}%", n(state.rh * 100.0, 2)),
            reference: "ASHRAE Fundamentals Ch. 1",
            caution: Some(
                "Relative humidity is a ratio of PRESSURES. Degree of saturation W/W_s is a \
                 ratio of MASSES, and the two agree only at 0% and 100%.",
            ),
        },
        Step {
            property: "w",
            equation: "W = 0.621945 · p_wv / (p − p_wv)",
            substitution: format!(
                "{} = {MASS_RATIO} × {} / ({} − {})",
                n(state.w, 6),
                n(state.p_wv, 2),
                n(p, 2),
                n(state.p_wv, 2)
            ),
            result: n(state.w, 6),
            reference: "ASHRAE RP-1485; M_wv/M_da = 0.621945",
            caution: None,
        },
        Step {
            property: "mu",
            equation: "μ = W / W_s",
            substitution: format!("{} = {} / {}", n(state.mu, 4), n(state.w, 6), n(w_s, 6)),
            result: format!("{}%", n(state.mu * 100.0, 2)),
            reference: "ASHRAE Fundamentals Ch. 1",
            caution: Some(
                "Degree of saturation, not relative humidity. This state has them \
                 measurably apart.",
            ),
        },
        Step {
            property: "h",
            equation: "h = 1.006·t + W·(2499.86 + 1.84·t)",
            substitution: format!(
                "{} = {CP_DA} × {} + {} × ({H_G_REF} + {CP_WV} × {})",
                n(state.h, 3),
                n(state.t_db, 2),
                n(state.w, 6),
                n(state.t_db, 2)
            ),
            result: format!("{} kJ/kg_da", n(state.h, 3)),
            reference: "ASHRAE RP-1485",
            caution: Some(
                "The widely copied 2501 and 1.86 are the older values. Using them shifts \
                 every enthalpy, and therefore every coil load, by a small consistent amount.",
            ),
        },
        Step {
            property: "v",
            equation: "v = R_da·(t + 273.15)·(1 + 1.607858·W) / p",
            substitution: format!(
                "{} = {R_DA} × {} × (1 + 1.607858 × {}) / {}",
                n(state.v, 5),
                n(state.t_db + 273.15, 2),
                n(state.w, 6),
                n(p, 2)
            ),
            result: format!("{} m³/kg_da", n(state.v, 5)),
            reference: "ASHRAE RP-1485; R_da = 287.042 J/(kg·K)",
            caution: Some(
                "Per kilogram of DRY AIR, not of moist air. A mass balance divides volumetric \
                 flow by v; using moist-air density instead is wrong by about 1%.",
            ),
        },
        Step {
            property: "rho",
            equation: "ρ = (1 + W) / v",
            substitution: format!(
                "{} = (1 + {}) / {}",
                n(state.rho, 5),
                n(state.w, 6),
                n(state.v, 5)
            ),
            result: format!("{} kg/m³", n(state.rho, 5)),
            reference: "ASHRAE Fundamentals Ch. 1",
            caution: Some(
                "Reported for reference only. Mass balances use the dry-air basis above.",
            ),
        },
        Step {
            property: "wbt",
            equation: "solve t_wb from the adiabatic-saturation energy balance",
            substitution: format!(
                "t_wb = {} °C at t = {} °C, W = {}",
                n(state.t_wb, 2),
                n(state.t_db, 2),
                n(state.w, 6)
            ),
            result: format!("{} °C", n(state.t_wb, 2)),
            reference: "ASHRAE Fundamentals Ch. 1; solved iteratively",
            caution: Some(
                "This is the THERMODYNAMIC wet bulb, the temperature of adiabatic saturation. \
                 A sling psychrometer reads something else — close, but not the same quantity.",
            ),
        },
        Step {
            property: "dp",
            equation: "t_dp = t_sat(p_wv)",
            substitution: format!(
                "t_dp = t_sat({} Pa) = {} °C",
                n(state.p_wv, 2),
                n(state.t_dp, 2)
            ),
            result: format!("{} °C", n(state.t_dp, 2)),
            reference: "Inverse of the saturation line above",
            caution: if state.t_dp < 0.0 {
                Some(
                    "Below freezing this is a FROST point: the inversion is on the ice line, \
                     not the water line.",
                )
            } else {
                None
            },
        },
    ]
}

/// The size of the real-gas correction at this state.
///
/// §11's third requirement, and the reason `Atmosphere::real_gas` exists as a
/// toggle rather than a constant. Telling a student the enhancement factor is
/// "about half a percent" is a fact they have to take on trust; letting them
/// switch it off and watch the number move is a fact they can see.
#[derive(Debug, Clone, Copy)]
pub struct RealGasCorrection {
    /// Humidity ratio with the enhancement factor applied.
    pub w_real: f64,
    /// Humidity ratio under the ideal-gas treatment.
    pub w_ideal: f64,
    /// The difference as a percentage of the real-gas value.
    pub percent: f64,
}

/// Measures the enhancement factor's effect at a state.
///
/// # Errors
/// Returns the backend's message when either treatment cannot resolve.
pub fn real_gas_correction(
    t_db: f64,
    rh: f64,
    p_bar: f64,
) -> Result<RealGasCorrection, crate::backend::PropertyError> {
    use crate::state::Atmosphere;
    let real = StatePoint::from_db_rh(
        t_db,
        rh,
        &Atmosphere {
            p_bar,
            real_gas: true,
        },
    )?;
    let ideal = StatePoint::from_db_rh(
        t_db,
        rh,
        &Atmosphere {
            p_bar,
            real_gas: false,
        },
    )?;
    Ok(RealGasCorrection {
        w_real: real.w,
        w_ideal: ideal.w,
        percent: if real.w != 0.0 {
            (real.w - ideal.w) / real.w * 100.0
        } else {
            0.0
        },
    })
}
