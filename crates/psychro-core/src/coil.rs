//! The cooling coil, and the design derivation that sizes an air system.
//!
//! Separate from [`crate::process`] because a coil is not one process vector —
//! it is a *construction*. The apparatus dew point is found by extending the
//! line through the entering and leaving states until it meets the saturation
//! curve, and everything else on a coil datasheet follows from where that
//! intersection lands.
//!
//! # Why the bypass factor is reported three ways
//!
//! Every textbook gives it as
//!
//! ```text
//! BF = (t_lvg − t_adp)/(t_ent − t_adp)
//!    = (W_lvg − W_adp)/(W_ent − W_adp)
//!    = (h_lvg − h_adp)/(h_ent − h_adp)
//! ```
//!
//! and treats the three as interchangeable. They are interchangeable only
//! because the leaving state lies on the straight line to the ADP, which is
//! exactly the property this module constructs. Reporting all three lets a
//! reader check a result against whichever form their reference uses, and lets
//! a test assert the construction rather than trust it.

use crate::backend::PropertyError;
use crate::constants::CP_DA;
use crate::process::Load;
use crate::state::{Atmosphere, StatePoint};

/// Specific heat of liquid water, kJ/(kg·K).
///
/// ASHRAE's condensate term is `h_f = c_pw · t` referred to liquid water at
/// 0 °C. It is under 1% of a coil's total load, which is exactly why it gets
/// dropped — and why it is written down here instead.
const CP_WATER: f64 = 4.186;

/// A cooling coil, as a datasheet would describe it.
#[derive(Debug, Clone, Copy)]
pub struct Coil {
    /// Entering air.
    pub entering: StatePoint,
    /// Leaving air.
    pub leaving: StatePoint,
    /// The apparatus dew point: saturated air at the coil's effective surface.
    pub adp: StatePoint,
    /// Bypass factor on temperature.
    pub bf_temperature: f64,
    /// Bypass factor on humidity ratio.
    pub bf_humidity_ratio: f64,
    /// Bypass factor on enthalpy.
    pub bf_enthalpy: f64,
    /// Coil sensible heat ratio, `c_p,ma·(t_ent − t_lvg)/(h_ent − h_lvg)`.
    pub shr: f64,
    /// Total load, kW: the air-side drop **less** the condensate it carries out.
    pub total_load: f64,
    /// The air-side enthalpy drop alone, kW.
    pub air_side_load: f64,
    /// Condensate, kg/s. Zero for a dry coil.
    pub condensate: f64,
    /// The energy and moisture the process moved, on the §4.9 decomposition.
    pub load: Load,
    /// Whether the coil ran dry — no condensation, so no apparatus dew point.
    pub dry: bool,
}

/// Solves a coil from its entering and leaving states.
///
/// The ADP is the intersection of the extended process line with the saturation
/// curve, found by bisection on the extension parameter. Bisection rather than
/// a closed form because the saturation curve has no algebraic inverse in the
/// chart's coordinates and a Newton step near the tangent case is unstable —
/// this runs in a few dozen property calls and is not on any hot path.
///
/// # Errors
/// Returns a message when the two states do not describe a cooling process, or
/// when the extended line never meets saturation.
pub fn from_leaving(
    entering: &StatePoint,
    leaving: &StatePoint,
    mdot_da: f64,
    atm: &Atmosphere,
) -> Result<Coil, PropertyError> {
    if leaving.h >= entering.h {
        return Err(PropertyError::supersaturated(
            "a cooling coil must lower the enthalpy of the air".to_string(),
        ));
    }

    // A coil that removes no moisture never reaches saturation, so there is no
    // apparatus dew point to find. That is a *dry coil*, and it is a real
    // design — a sensible-only coil above the entering dew point — rather than
    // a failure to converge.
    let dry = (entering.w - leaving.w).abs() < 1e-9;

    let adp = if dry {
        // The construction degenerates to the leaving state itself: with the
        // line horizontal it meets saturation at the leaving air's own dew
        // point, and the bypass factor is then read on temperature alone.
        StatePoint::from_db_rh(leaving.t_dp, 1.0, atm)?
    } else {
        extend_to_saturation(entering, leaving, atm)?
    };

    let bf_temperature = ratio(leaving.t_db - adp.t_db, entering.t_db - adp.t_db);
    let bf_humidity_ratio = ratio(leaving.w - adp.w, entering.w - adp.w);
    let bf_enthalpy = ratio(leaving.h - adp.h, entering.h - adp.h);

    let condensate = mdot_da * (entering.w - leaving.w);
    let air_side_load = mdot_da * (entering.h - leaving.h);
    // The condensate leaves the airstream carrying its own enthalpy, referred
    // to liquid water at 0 °C and evaluated at the leaving air temperature —
    // ASHRAE's convention, because the drain water leaves at the coil's
    // leaving condition.
    let condensate_heat = condensate * CP_WATER * leaving.t_db;
    let total_load = air_side_load - condensate_heat;

    // Coil SHR is defined on the air-side drop, per REQUIREMENTS §4.2, not on
    // the condensate-corrected load. Mixing the two definitions is how a coil
    // selection ends up a percent off its own datasheet.
    let cp_ma = CP_DA + crate::constants::CP_WV * entering.w;
    let shr = ratio(
        cp_ma * (entering.t_db - leaving.t_db),
        entering.h - leaving.h,
    );

    Ok(Coil {
        entering: *entering,
        leaving: *leaving,
        adp,
        bf_temperature,
        bf_humidity_ratio,
        bf_enthalpy,
        shr,
        total_load,
        air_side_load,
        condensate,
        load: crate::process::load(entering, leaving, mdot_da),
        dry,
    })
}

/// Solves a coil forward, from an apparatus dew point and a bypass factor.
///
/// The inverse of [`from_leaving`], and the form a designer selects equipment
/// in: pick a coil (which fixes the ADP) and a face velocity (which fixes the
/// bypass factor), and the leaving state follows.
///
/// # Errors
/// Returns the backend's message when the resulting state is not moist air.
pub fn from_adp(
    entering: &StatePoint,
    t_adp: f64,
    bypass_factor: f64,
    mdot_da: f64,
    atm: &Atmosphere,
) -> Result<Coil, PropertyError> {
    let adp = StatePoint::from_db_rh(t_adp, 1.0, atm)?;
    // The leaving state is the bypass factor of the way back from the ADP
    // toward the entering state, interpolating the (W, h) pair the chart is
    // built from — which is what makes all three BF forms agree afterwards.
    let w = adp.w + bypass_factor * (entering.w - adp.w);
    let h = adp.h + bypass_factor * (entering.h - adp.h);
    let leaving = StatePoint::from_h_w(h, w, atm)?;
    from_leaving(entering, &leaving, mdot_da, atm)
}

/// A ratio that reports zero rather than a division by zero.
fn ratio(numerator: f64, denominator: f64) -> f64 {
    if denominator.abs() < f64::EPSILON {
        0.0
    } else {
        numerator / denominator
    }
}

/// Finds where the line through two states meets the saturation curve.
///
/// Parametrised beyond the leaving state: `f = 0` is the leaving state and
/// `f = 1` is as far again. The state is below saturation on one side of the
/// crossing and above it on the other, so bisecting on "does this resolve?" is
/// a well-behaved bracket even where the geometry is nearly tangent.
fn extend_to_saturation(
    entering: &StatePoint,
    leaving: &StatePoint,
    atm: &Atmosphere,
) -> Result<StatePoint, PropertyError> {
    let dw = leaving.w - entering.w;
    let dh = leaving.h - entering.h;
    let at = |f: f64| {
        let w = leaving.w + f * dw;
        let h = leaving.h + f * dh;
        StatePoint::from_h_w(h, w, atm)
    };

    // Walk out until the extension leaves the physical region, which is the
    // crossing. Sixteen doublings covers any coil a chart can draw.
    let mut lo = 0.0_f64;
    let mut hi = 0.0_f64;
    let mut step = 0.125_f64;
    let mut found = false;
    for _ in 0..16 {
        hi += step;
        if at(hi).is_err() {
            found = true;
            break;
        }
        lo = hi;
        step *= 1.5;
    }
    if !found {
        return Err(PropertyError::supersaturated(
            "the process line does not reach saturation; the coil may be running dry".to_string(),
        ));
    }

    for _ in 0..80 {
        let mid = 0.5 * (lo + hi);
        if at(mid).is_ok() {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    // `lo` is the last point that still resolves, so it is the crossing from
    // inside. Re-resolving it as saturated pins it exactly onto the curve.
    let edge = at(lo)?;
    StatePoint::from_db_rh(edge.t_dp, 1.0, atm)
}

/// The room condition line, and the airflow it implies.
///
/// `REQUIREMENTS.md` §4.9. This is the derivation that turns a load into an air
/// system: the room sensible heat ratio fixes the *direction* the supply air
/// must approach the room along, and the supply temperature difference fixes how
/// much air it takes.
#[derive(Debug, Clone, Copy)]
pub struct DesignAir {
    /// Room sensible heat ratio, `q_s,room / q_t,room`.
    pub rshf: f64,
    /// Dry-air mass flow the room needs, kg/s.
    pub mdot_da: f64,
    /// Volumetric flow at the *supply* state, m³/s.
    ///
    /// `V̇ = ṁ_da · v_SA`, using the specific volume of the air being delivered.
    /// Sizing a fan on the room's specific volume instead is a common and
    /// invisible error, because the two differ by only a few percent.
    pub volumetric_flow: f64,
    /// The supply state the room condition line reaches.
    pub supply: StatePoint,
}

/// Derives the supply air condition and flow for a room load.
///
/// `q_sensible` and `q_latent` are the room's gains in kW. `t_supply` is the
/// dry-bulb the air is delivered at; §4.9 puts the usual difference at 10–14 K
/// below the room.
///
/// # Errors
/// Returns a message when the supply temperature is not below the room, or when
/// the resulting supply state is not moist air.
pub fn design_air(
    room: &StatePoint,
    q_sensible: f64,
    q_latent: f64,
    t_supply: f64,
    atm: &Atmosphere,
) -> Result<DesignAir, PropertyError> {
    if t_supply >= room.t_db {
        return Err(PropertyError::supersaturated(
            "supply air must be cooler than the room it is cooling".to_string(),
        ));
    }
    let q_total = q_sensible + q_latent;
    let rshf = ratio(q_sensible, q_total);

    // The textbook one-shot is `ṁ_da = q_s / (c_p,ma·Δt)`, and that is where
    // this starts — but it is not where it stops.
    //
    // `c_p,ma·Δt` and the §4.9 load split disagree by a fraction of a percent
    // whenever the humidity ratio moves, because `Δh − h_g,ref·ΔW` carries a
    // `c_p,wv·Δ(W·t)` term that a single `c_p,ma` cannot. Sizing the fan by one
    // definition and reporting the load by the other produces a design whose
    // own numbers do not add up — 20.06 kW of sensible load delivered by air
    // sized for 20.00 kW — which is exactly the kind of small inconsistency
    // that makes a reader stop trusting a tool.
    //
    // So the flow is solved for instead: find the ṁ and W_SA at which the air
    // absorbs precisely the stated sensible and latent loads, under the same
    // decomposition the panel prints. Two equations, two unknowns, and the
    // coupling is weak enough that a handful of substitutions converge to
    // machine precision.
    let cp_ma = CP_DA + crate::constants::CP_WV * room.w;
    let mut mdot_da = q_sensible / (cp_ma * (room.t_db - t_supply));

    for _ in 0..40 {
        let w_supply = room.w - q_latent / (mdot_da * crate::constants::H_G_REF);
        let h_supply = enthalpy_at(t_supply, w_supply, atm)?;
        let next = q_total / (room.h - h_supply);
        if !next.is_finite() || next <= 0.0 {
            return Err(PropertyError::supersaturated(
                "no supply flow satisfies this load at that supply temperature".to_string(),
            ));
        }
        if (next - mdot_da).abs() < 1e-12 * next.abs().max(1.0) {
            mdot_da = next;
            break;
        }
        mdot_da = next;
    }

    let w_supply = room.w - q_latent / (mdot_da * crate::constants::H_G_REF);
    let supply = StatePoint::from_db_w(t_supply, w_supply, atm)?;

    Ok(DesignAir {
        rshf,
        mdot_da,
        volumetric_flow: mdot_da * supply.v,
        supply,
    })
}

/// Specific enthalpy at a state, without resolving the other eleven properties.
fn enthalpy_at(t_db: f64, w: f64, atm: &Atmosphere) -> Result<f64, PropertyError> {
    if atm.real_gas {
        crate::backend::enthalpy(t_db, w, atm.p_bar)
    } else {
        Ok(crate::state::enthalpy(t_db, w))
    }
}

/// The primary return-air cycle, computed and plotted in one action.
///
/// `REQUIREMENTS.md` §4.9's cycle macro: outdoor air mixed with return air,
/// through a coil, into the room, and back. It is the shape almost every
/// air-handling unit takes, and computing it by hand is six chart constructions
/// a designer repeats for every zone.
///
/// The macro is deliberately *not* a black box: every intermediate state is
/// returned, so each one can be drawn, checked, and reasoned about. A macro
/// that reported only the coil load would be faster to write and impossible to
/// trust.
#[derive(Debug, Clone, Copy)]
pub struct ReturnAirCycle {
    /// Outdoor air.
    pub outdoor: StatePoint,
    /// Room air, which is also the return air.
    pub room: StatePoint,
    /// The mixed state entering the coil.
    pub mixed: StatePoint,
    /// The state leaving the coil — the supply air.
    pub supply: StatePoint,
    /// The coil that makes it, with its ADP and bypass factors.
    pub coil: Coil,
    /// The room's own design derivation.
    pub design: DesignAir,
    /// Outdoor-air dry-air mass flow, kg/s.
    pub mdot_outdoor: f64,
    /// Total supply dry-air mass flow, kg/s.
    pub mdot_supply: f64,
    /// Whether the mixing line fogged. Cold-climate mixing boxes do.
    pub mixing_fogged: bool,
}

/// Computes a primary return-air cycle from a room load and a ventilation rate.
///
/// The order is the one the air takes: size the supply air from the room load,
/// mix the ventilation fraction into the return, then find the coil that gets
/// the mixture to the supply state. Sizing first is what makes the coil a
/// *consequence* of the design rather than an assumption in it.
///
/// # Errors
/// Returns a message when the room cannot be served at that supply temperature,
/// or when the coil implied by the result is not a cooling coil.
pub fn return_air_cycle(
    outdoor: &StatePoint,
    room: &StatePoint,
    q_sensible: f64,
    q_latent: f64,
    t_supply: f64,
    outdoor_fraction: f64,
    atm: &Atmosphere,
) -> Result<ReturnAirCycle, PropertyError> {
    let design = design_air(room, q_sensible, q_latent, t_supply, atm)?;
    let mdot_supply = design.mdot_da;
    let mdot_outdoor = outdoor_fraction.clamp(0.0, 1.0) * mdot_supply;
    let mdot_return = mdot_supply - mdot_outdoor;

    let mixed_result = crate::process::mix(outdoor, mdot_outdoor, room, mdot_return, atm);
    let (mixed, mixing_fogged) = match mixed_result {
        crate::process::MixResult::Mixed { outlet, .. } => (outlet, false),
        crate::process::MixResult::WinterV { outlet, .. } => (outlet, true),
        crate::process::MixResult::NoFlow => {
            return Err(PropertyError::supersaturated(
                "the cycle has no air flowing through it".to_string(),
            ))
        }
        crate::process::MixResult::Failed(e) => return Err(e),
    };

    let coil = from_leaving(&mixed, &design.supply, mdot_supply, atm)?;

    Ok(ReturnAirCycle {
        outdoor: *outdoor,
        room: *room,
        mixed,
        supply: design.supply,
        coil,
        design,
        mdot_outdoor,
        mdot_supply,
        mixing_fogged,
    })
}
