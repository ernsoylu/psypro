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
use crate::coil::Coil;
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
    ///
    /// Unlike [`slope_from_shr`] this always has an answer, so it returns one
    /// rather than an `Option` a caller has to unwrap.
    #[must_use]
    pub fn shr_from_slope(slope: f64) -> f64 {
        if slope.abs() < f64::EPSILON {
            0.0
        } else {
            1.0 - H_G_REF / slope
        }
    }
}

/// The bypass factor a wet coil runs at when the caller states no other.
///
/// A real four-to-six row coil at a normal face velocity, which leaves air at
/// around 90–93% relative humidity — where coils are actually measured.
///
/// Zero is the tempting default and it is the wrong one. At a *fixed leaving
/// temperature* — which is how a user states a coil, "cool it to 12 °C" — no
/// bypass means the air leaves exactly saturated, and saturated air at 12 °C is
/// **wetter** than any real coil delivers there. Zero bypass therefore
/// understates the dehumidification rather than overstating it, which is the
/// opposite of the intuition carried over from the fixed-ADP form, where less
/// bypass does mean more water out. Both readings are available by typing a
/// number; only one of them is a coil.
pub const DEFAULT_BYPASS_FACTOR: f64 = 0.10;

/// Below this apparatus dew point a wet coil frosts rather than drains.
///
/// Reported rather than refused: a surface below freezing is a real operating
/// condition — it is what a DX coil does when it is starved of air — and the
/// anti-ice limit of `REQUIREMENTS.md` §4.2 is a warning a designer acts on,
/// not a reason for the tool to go blank.
pub const FROST_LIMIT_C: f64 = 0.0;

/// A cooling process, wet or dry, and the water it took out of the air.
#[derive(Debug, Clone, Copy)]
pub struct CoolResult {
    /// Where the air ended up and what it cost.
    pub process: ProcessResult,
    /// Water condensed out, kg/s. Zero for a dry coil.
    pub condensate: f64,
    /// The full coil construction, when the coil ran wet.
    ///
    /// `None` for a dry coil, which has no apparatus dew point: the process is
    /// horizontal and the bypass factor has nothing to act on.
    pub coil: Option<Coil>,
    /// Whether the surface the bypass factor implies sits below freezing.
    pub frost_risk: bool,
}

impl CoolResult {
    /// Whether the coil ran wet and took moisture out.
    #[must_use]
    pub fn dehumidified(&self) -> bool {
        self.coil.is_some()
    }
}

/// Cooling to a target dry-bulb temperature, condensing when the coil runs wet.
///
/// This is the process a user draws when they say "cool the air to 13 °C", and
/// it is the one [`sensible_to`] cannot express. Holding `W` down to a target
/// below the entering dew point asks for a state above the saturation curve,
/// which is not air; the honest answer is not an error but a **wet coil**.
///
/// # The construction
///
/// A coil is a surface at the apparatus dew point and a bypass fraction that
/// never touches it. The temperature form of the bypass factor inverts in closed
/// form, which is what makes the leaving temperature the user typed the leaving
/// temperature they get:
///
/// ```text
/// BF = (t_lvg − t_adp)/(t_ent − t_adp)   ⇒   t_adp = (t_lvg − BF·t_ent)/(1 − BF)
/// ```
///
/// The surface then decides whether anything condenses, and **the surface is the
/// test, not the target temperature**. With `t_adp ≥ t_dp,ent` nothing on the
/// coil is cold enough to reach the dew point: the air cools at constant `W` and
/// the process is the horizontal one. Below it the contacted air leaves
/// saturated at `t_adp`, the bypassed air leaves unchanged, and the two mix:
///
/// ```text
/// W_lvg = W_adp + BF·(W_ent − W_adp)
/// ```
///
/// Testing the surface rather than the target is what makes the result
/// *continuous*: at `t_adp = t_dp,ent` the saturated surface humidity equals the
/// entering humidity, so `W_lvg = W_ent` and the wet branch meets the dry one
/// exactly. Testing `t_lvg` against the dew point instead puts a step in the
/// condensate at the boundary, which shows up as a coil that starts draining
/// water the moment a target crosses a threshold.
///
/// The leaving state is handed to [`crate::coil::from_leaving`]
/// for the report, so the apparatus dew point printed here comes from the same
/// extended-chord construction as every other ADP in the tool rather than from a
/// second definition that would agree with it only approximately.
///
/// # Errors
/// Returns the backend's message when the target is unreachable — a bypass
/// factor outside `[0, 1)`, or a surface so cold that saturated air at it is not
/// a state the backend will resolve.
pub fn cool_to(
    inlet: &StatePoint,
    t_out: f64,
    bypass_factor: f64,
    mdot_da: f64,
    atm: &Atmosphere,
) -> Result<CoolResult, PropertyError> {
    if !(0.0..1.0).contains(&bypass_factor) {
        return Err(PropertyError::supersaturated(format!(
            "a bypass factor lies in [0, 1); {bypass_factor} would put the leaving air on the \
             wrong side of the coil"
        )));
    }

    let estimate = (t_out - bypass_factor * inlet.t_db) / (1.0 - bypass_factor);

    // The dry case, which includes every heating process and every cooling
    // process whose surface stays above the entering dew point. Decided on
    // temperatures alone, so the common case costs no property calls at all.
    //
    // The estimate is *exact* at this boundary, which is why the branch can be
    // taken on it. Holding `W` makes enthalpy linear in temperature, so the
    // chord's own leaving temperature is `t_dp + BF·(t_ent − t_dp)` exactly, and
    // the estimate inverts that without error. Away from the boundary the
    // estimate drifts, which is what the refinement below is for.
    if estimate >= inlet.t_dp {
        let outlet = StatePoint::from_db_w(t_out, inlet.w, atm)?;
        return Ok(CoolResult {
            process: finish(inlet, outlet, mdot_da),
            condensate: 0.0,
            coil: None,
            frost_risk: false,
        });
    }

    let t_adp = refine_adp(inlet, t_out, bypass_factor, estimate, atm)?;
    let coil = crate::coil::from_adp(inlet, t_adp, bypass_factor, mdot_da, atm)?;

    Ok(CoolResult {
        process: finish(inlet, coil.leaving, mdot_da),
        condensate: coil.condensate,
        coil: Some(coil),
        frost_risk: t_adp < FROST_LIMIT_C,
    })
}

/// The leaving temperature a surface at `t_adp` and a bypass of `bf` produce.
///
/// The two balances a mixing box obeys, and nothing else: dry-air mass gives
/// `W_lvg = BF·W_ent + (1 − BF)·W_adp` and energy gives the same in `h`. The
/// leaving *temperature* is then whatever that `(W, h)` pair resolves to — it is
/// **not** the linear interpolation of the two temperatures, because enthalpy
/// carries a `c_pv·W·t` cross term. Treating it as linear is the approximation
/// [`cool_to`] starts from and then removes.
fn leaving_temperature(
    inlet: &StatePoint,
    bf: f64,
    t_adp: f64,
    atm: &Atmosphere,
) -> Result<f64, PropertyError> {
    let adp = StatePoint::from_db_rh(t_adp, 1.0, atm)?;
    let w = adp.w + bf * (inlet.w - adp.w);
    let h = adp.h + bf * (inlet.h - adp.h);
    Ok(StatePoint::from_h_w(h, w, atm)?.t_db)
}

/// Finds the apparatus dew point whose coil leaves the air at `t_out`.
///
/// A secant iteration from the closed-form estimate, which is already within a
/// few hundredths of a kelvin: two or three steps land on the leaving
/// temperature the user typed, to a tolerance far below anything a panel prints.
///
/// This matters more than the size of the residual suggests. Without it the
/// bypass factor read back off the solved coil differs in the third decimal from
/// the one that was typed into the field beside it, and a reader who spots that
/// has no way to tell which of the two numbers is the lie.
fn refine_adp(
    inlet: &StatePoint,
    t_out: f64,
    bf: f64,
    estimate: f64,
    atm: &Atmosphere,
) -> Result<f64, PropertyError> {
    let mut a = estimate;
    let mut fa = leaving_temperature(inlet, bf, a, atm)? - t_out;
    // A tenth of a kelvin away: close enough to stay in the linear regime, far
    // enough that the secant's denominator is not noise.
    let mut b = estimate - 0.1;
    let mut fb = leaving_temperature(inlet, bf, b, atm)? - t_out;

    for _ in 0..12 {
        if fb.abs() < 1.0e-10 {
            break;
        }
        let denominator = fb - fa;
        if denominator.abs() < f64::EPSILON {
            break;
        }
        let next = b - fb * (b - a) / denominator;
        a = b;
        fa = fb;
        b = next;
        fb = leaving_temperature(inlet, bf, b, atm)? - t_out;
    }
    Ok(b)
}

/// Desiccant dehumidification: the mirror image of evaporative cooling.
///
/// The air leaves **warmer and drier**, which is the half of §4.1's vocabulary a
/// tool that only goes down-and-left cannot draw. The latent heat released as
/// vapour is sorbed reappears in the airstream as sensible heat, so the ideal
/// path is a line of constant enthalpy running down and to the right.
///
/// `w_equilibrium` is the humidity ratio the airstream would reach if the
/// desiccant were given unlimited contact — set by wheel position and
/// regeneration temperature for a solid wheel, by solution concentration and
/// temperature for a liquid one. It is a property of the *device*, which is why
/// it is a parameter: two wheels at the same latent effectiveness and different
/// equilibria put the outlet in different places.
///
/// `eps_latent` is `ε_L = (W_in − W_out)/(W_in − W_eq)`, per §4.4.
///
/// The constant-enthalpy path is the idealisation §4.4 states. A real wheel
/// leaves slightly above it, because the heat of wetting is not zero and the
/// regeneration stream leaks a little heat across; that correction needs a
/// device model rather than two numbers, and pretending to it here would be
/// precision the inputs do not carry.
///
/// # Errors
/// Returns the backend's message when the outlet is not moist air, which for a
/// desiccant means an equilibrium humidity ratio below zero.
pub fn desiccant(
    inlet: &StatePoint,
    w_equilibrium: f64,
    eps_latent: f64,
    mdot_da: f64,
    atm: &Atmosphere,
) -> Result<ProcessResult, PropertyError> {
    let w_out = inlet.w - eps_latent * (inlet.w - w_equilibrium);
    if w_out < 0.0 {
        return Err(PropertyError::supersaturated(format!(
            "a desiccant cannot dry air past zero moisture: W_out would be {w_out:.6}"
        )));
    }
    let outlet = StatePoint::from_h_w(inlet.h, w_out, atm)?;
    Ok(finish(inlet, outlet, mdot_da))
}
