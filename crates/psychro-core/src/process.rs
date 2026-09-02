//! Processes: the vectors that join one state to another, and what they cost.
//!
//! Every function here resolves its outlet through [`StatePoint`], so the
//! thermodynamics still comes from frees. What this module adds is the part
//! that is *not* a property lookup — the balances, the effectiveness
//! definitions, and the load decomposition — which are definitions rather than
//! formulations and belong on this side of the boundary.
//!
//! # The load decomposition, and why it is written this way
//!
//! The obvious way to split a load is `q_s = ṁ·c_p,ma·Δt` and `q_l = q_t − q_s`.
//! This module does the opposite:
//!
//! ```text
//! q_total    = ṁ_da · (h_out − h_in)
//! q_latent   = ṁ_da · h_g,ref · (W_out − W_in)
//! q_sensible = q_total − q_latent
//! ```
//!
//! with the same `h_g,ref = 2499.86` the chart's reduced coordinate is defined
//! against. That is not a stylistic choice. It makes the SHR protractor
//! **exact** rather than approximate:
//!
//! ```text
//! Δh/ΔW = q_t / (ṁ·ΔW) = q_t·h_g,ref / q_l = h_g,ref / (1 − SHR)
//! ```
//!
//! which is the relation `REQUIREMENTS.md` §4.9 specifies. Split the load the
//! other way and the protractor drawn on the chart disagrees with the numbers in
//! the panel by a fraction of a percent — small enough to survive review and
//! large enough to make a reader distrust both.

use crate::backend::PropertyError;
use crate::constants::H_G_REF;
use crate::state::{Atmosphere, StatePoint};

/// The energy and moisture a process moves.
///
/// Loads are in kilowatts for a dry-air mass flow in kg/s, which is the basis
/// every mass balance in this project uses — never `V̇ · ρ_moist`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Load {
    /// Total load, kW. Positive when the process adds energy to the air.
    pub total: f64,
    /// Sensible load, kW.
    pub sensible: f64,
    /// Latent load, kW.
    pub latent: f64,
    /// Moisture added, kg/s. Negative for dehumidification.
    pub moisture: f64,
    /// Sensible heat ratio, `q_s / q_t`, or `None` when there is no total load.
    pub shr: Option<f64>,
}

/// The energy and moisture moved between two states, at a given dry-air flow.
///
/// `mdot_da` is **dry-air** mass flow, `V̇ / v_da`. Using `V̇ · ρ_moist` instead
/// is wrong by about 1% and is the most common error in the field, which is why
/// the name says so.
#[must_use]
pub fn load(inlet: &StatePoint, outlet: &StatePoint, mdot_da: f64) -> Load {
    let total = mdot_da * (outlet.h - inlet.h);
    let moisture = mdot_da * (outlet.w - inlet.w);
    let latent = moisture * H_G_REF;
    let sensible = total - latent;
    Load {
        total,
        sensible,
        latent,
        moisture,
        // A process with no total load has no ratio to report. Returning zero
        // would be a number, and a reader would believe it.
        shr: if total.abs() > f64::EPSILON {
            Some(sensible / total)
        } else {
            None
        },
    }
}

/// A resolved process: where it ends, what it moved, and what to warn about.
#[derive(Debug, Clone, Copy)]
pub struct ProcessResult {
    /// The state the air leaves in.
    pub outlet: StatePoint,
    /// What the process moved.
    pub load: Load,
    /// Whether the result sits close enough to saturation to need a second look.
    pub near_saturation: bool,
}

/// Above this relative humidity a "sensible-only" process is a fiction.
///
/// `REQUIREMENTS.md` §4.1: sensible cooling has a practical limit around 85% RH,
/// beyond which condensation begins and the process is no longer horizontal. The
/// engine flags it rather than extrapolating a horizontal line into the
/// saturation curve, because the extrapolation is where a design silently stops
/// being a design.
pub const SENSIBLE_LIMIT_RH: f64 = 0.85;

/// Wraps an outlet with its load and its saturation warning.
fn finish(inlet: &StatePoint, outlet: StatePoint, mdot_da: f64) -> ProcessResult {
    ProcessResult {
        load: load(inlet, &outlet, mdot_da),
        near_saturation: outlet.rh >= SENSIBLE_LIMIT_RH,
        outlet,
    }
}

/// Sensible heating or cooling: humidity ratio held, dry bulb moved.
///
/// Horizontal on the chart, and the data-centre case — a load that is entirely
/// sensible, SHR = 1.0 — is the *normal* use of this, not a degenerate one.
///
/// # Errors
/// Returns the backend's message when the outlet is not moist air, which for a
/// cooling process means the target is below the inlet dew point.
pub fn sensible_to(
    inlet: &StatePoint,
    t_out: f64,
    mdot_da: f64,
    atm: &Atmosphere,
) -> Result<ProcessResult, PropertyError> {
    let outlet = StatePoint::from_db_w(t_out, inlet.w, atm)?;
    Ok(finish(inlet, outlet, mdot_da))
}

/// Sensible heating or cooling by a duty rather than to a temperature.
///
/// `q` is in kilowatts, positive for heating. The outlet temperature is found
/// from the enthalpy the duty produces, so a reheat coil specified in kW lands
/// where the chart says it does.
///
/// # Errors
/// Returns the backend's message when the outlet is not moist air.
pub fn sensible_duty(
    inlet: &StatePoint,
    q: f64,
    mdot_da: f64,
    atm: &Atmosphere,
) -> Result<ProcessResult, PropertyError> {
    let h_out = inlet.h + q / mdot_da;
    let outlet = StatePoint::from_h_w(h_out, inlet.w, atm)?;
    Ok(finish(inlet, outlet, mdot_da))
}

/// Adiabatic mixing of two airstreams, on a dry-air mass basis.
///
/// `W_mix` and `h_mix` are the flow-weighted means, which puts the mix point on
/// the straight line between the two states at the fraction the flows set. The
/// volumetric approximation for `t_mix` carries under 1% error and is *not*
/// offered here: it is a labelled approximation in the UI, not a result.
///
/// # Errors
/// Returns [`MixResult::WinterV`] rather than an error when the mix line crosses
/// saturation; see that variant.
#[must_use]
pub fn mix(
    a: &StatePoint,
    mdot_a: f64,
    b: &StatePoint,
    mdot_b: f64,
    atm: &Atmosphere,
) -> MixResult {
    let total = mdot_a + mdot_b;
    if total <= 0.0 {
        return MixResult::NoFlow;
    }
    let w = (mdot_a * a.w + mdot_b * b.w) / total;
    let h = (mdot_a * a.h + mdot_b * b.h) / total;

    match StatePoint::from_h_w(h, w, atm) {
        Ok(outlet) => MixResult::Mixed {
            outlet,
            mdot_da: total,
        },
        Err(_) => {
            // The chord between two unsaturated states can pass above the
            // saturation curve, because that curve is convex. Physically the
            // mixture fogs: it settles on the saturation line at the mixture's
            // enthalpy, and the excess moisture condenses out.
            //
            // This is "Winter V" mixing, and a tool that reports an error here
            // is refusing to model a thing that happens in every cold-climate
            // mixing box.
            match StatePoint::from_h_rh(h, 1.0, atm) {
                Ok(outlet) => MixResult::WinterV {
                    condensate: (w - outlet.w) * total,
                    outlet,
                    mdot_da: total,
                },
                Err(e) => MixResult::Failed(e),
            }
        }
    }
}

/// What a mix produced.
#[derive(Debug, Clone)]
pub enum MixResult {
    /// An ordinary mix, on the line between the two inlets.
    Mixed {
        /// The mixed state.
        outlet: StatePoint,
        /// Combined dry-air mass flow, kg/s.
        mdot_da: f64,
    },
    /// The mix line crossed saturation: the mixture fogs and water drops out.
    WinterV {
        /// The saturated state the mixture settles at.
        outlet: StatePoint,
        /// Combined dry-air mass flow, kg/s.
        mdot_da: f64,
        /// Water condensed out of the mixture, kg/s.
        condensate: f64,
    },
    /// Both streams have zero flow, so there is nothing to mix.
    NoFlow,
    /// Neither the mix nor its saturated fallback resolved.
    Failed(PropertyError),
}

/// Steam (isothermal) humidification to a target humidity ratio.
///
/// The latent heat was supplied in the boiler, so this is closer to mixing two
/// gases than to heating air: the dry bulb barely moves. The process slope is
/// `Δh/ΔW = h_g` of the *injected steam*, which is why `h_steam` is a parameter
/// rather than a constant — dry saturated steam at 100 °C and superheated steam
/// from an electrode cylinder put the outlet in different places.
///
/// # Errors
/// Returns the backend's message when the target is above saturation.
pub fn steam_humidify(
    inlet: &StatePoint,
    w_target: f64,
    h_steam: f64,
    mdot_da: f64,
    atm: &Atmosphere,
) -> Result<SteamResult, PropertyError> {
    let dw = w_target - inlet.w;
    let h_out = inlet.h + dw * h_steam;
    let outlet = StatePoint::from_h_w(h_out, w_target, atm)?;
    Ok(SteamResult {
        process: finish(inlet, outlet, mdot_da),
        steam_flow: mdot_da * dw,
    })
}

/// A humidification process and the water it consumed.
#[derive(Debug, Clone, Copy)]
pub struct SteamResult {
    /// Where the air ended up and what it cost.
    pub process: ProcessResult,
    /// Steam injected, kg/s. `ṁ_steam = ṁ_da·(W_out − W_in)`.
    pub steam_flow: f64,
}

/// Evaporative (adiabatic) humidification along a constant wet-bulb line.
///
/// `effectiveness` is the saturation effectiveness
/// `ε = (t_in − t_out)/(t_in − t_wb,in)`: the fraction of the wet-bulb
/// depression the device actually delivers. Typical values, from §4.3 — air
/// washer with opposed spray banks 0.95–0.98, 300 mm rigid media 0.88–0.91,
/// residential aspen or mesh media 0.50–0.60.
///
/// The path is constant wet-bulb, not constant enthalpy. The two are close
/// enough to draw as one line and are not the same: the water entering the
/// airstream brings its own enthalpy with it.
///
/// # Errors
/// Returns the backend's message when the outlet is not moist air.
pub fn evaporative(
    inlet: &StatePoint,
    effectiveness: f64,
    mdot_da: f64,
    atm: &Atmosphere,
) -> Result<ProcessResult, PropertyError> {
    let t_out = inlet.t_db - effectiveness * (inlet.t_db - inlet.t_wb);
    let outlet = StatePoint::from_db_wb(t_out, inlet.t_wb, atm)?;
    Ok(finish(inlet, outlet, mdot_da))
}

/// A general straight-line process: the state a `fraction` of the way from
/// `from` to `to`, interpolating on the `(W, h)` pair.
///
/// Interpolating `(W, h)` rather than `(W, t)` is what makes the result lie on
/// the straight line the chart draws, because the chart's own axes are built on
/// enthalpy. A `(W, t)` interpolation is a different curve, and it is the one a
/// renderer would draw if it interpolated the endpoints in screen space.
///
/// # Errors
/// Returns the backend's message when the interpolated pair is not moist air —
/// which can happen part-way along a chord that passes above saturation.
pub fn along(
    from: &StatePoint,
    to: &StatePoint,
    fraction: f64,
    atm: &Atmosphere,
) -> Result<StatePoint, PropertyError> {
    let w = from.w + fraction * (to.w - from.w);
    let h = from.h + fraction * (to.h - from.h);
    StatePoint::from_h_w(h, w, atm)
}

/// Air-to-air energy recovery, per ASHRAE Standard 84.
///
/// `eps_sensible` acts on temperature and `eps_latent` on humidity ratio, which
/// is how Standard 84 defines them — as two independently measured ratios. A
/// single "enthalpy effectiveness" cannot express a device whose sensible and
/// latent ratings differ, and a membrane core is exactly such a device.
///
/// Set `eps_latent` to zero for the sensible-only family: fixed plate, heat
/// wheel, heat pipe, run-around loop, thermosiphon.
///
/// # Errors
/// Returns the backend's message when the recovered state is not moist air.
pub fn energy_recovery(
    supply_in: &StatePoint,
    exhaust_in: &StatePoint,
    eps_sensible: f64,
    eps_latent: f64,
    mdot_da: f64,
    atm: &Atmosphere,
) -> Result<ProcessResult, PropertyError> {
    let t_out = supply_in.t_db + eps_sensible * (exhaust_in.t_db - supply_in.t_db);
    let w_out = supply_in.w + eps_latent * (exhaust_in.w - supply_in.w);
    let outlet = StatePoint::from_db_w(t_out, w_out, atm)?;
    Ok(finish(supply_in, outlet, mdot_da))
}

/// The protractor: the slope of a process line, and the ratio it corresponds to.
///
/// Two scales that are the same scale. `Δh/ΔW` is what the chart's geometry
/// gives directly; `SHR` is what a load calculation gives. Reading one off the
/// other is what the protractor on a printed chart is for.
pub mod protractor {
    use super::H_G_REF;

    /// The enthalpy-to-moisture slope for a sensible heat ratio.
    ///
    /// `Δh/ΔW = h_g,ref / (1 − SHR)`. Returns `None` at `SHR = 1`, where the
    /// slope is infinite because the process moves no moisture at all — the
    /// data-centre case, which is a real design and not a degenerate one. A
    /// caller draws it as the horizontal line it is.
    #[must_use]
    pub fn slope_from_shr(shr: f64) -> Option<f64> {
        let denominator = 1.0 - shr;
        if denominator.abs() < f64::EPSILON {
            None
        } else {
            Some(H_G_REF / denominator)
        }
    }

    /// The sensible heat ratio for an enthalpy-to-moisture slope.
    ///
    /// Inverse of [`slope_from_shr`]. A zero slope is `SHR = 0`: all latent,
    /// which is the dehumidification-only vector an internally cooled liquid
    /// desiccant draws.
    #[must_use]
    pub fn shr_from_slope(slope: f64) -> Option<f64> {
        if slope.abs() < f64::EPSILON {
            Some(0.0)
        } else {
            Some(1.0 - H_G_REF / slope)
        }
    }
}
