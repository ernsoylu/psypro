//! Naming the process that joins two states, and backing out what defines it.
//!
//! The forward direction — parameters in, outlet out — is [`crate::process`].
//! This is the reverse: a user has two points on the chart and wants to know
//! *what happened between them*, in the vocabulary of `REQUIREMENTS.md` §4.1,
//! with the numbers a datasheet would carry.
//!
//! # Why this is classification rather than physics
//!
//! Nothing here computes a property. Every test is a *definition* checked
//! against two already-resolved states: a process that holds `W` is sensible
//! because that is what sensible means; one that holds the wet bulb is
//! adiabatic humidification because that is what adiabatic humidification means.
//! So this sits beside the load decomposition on PsyPro's side of the boundary
//! rather than upstream in frees, which supplies properties and takes no view on
//! what a designer was doing with them.
//!
//! # The tolerances are the whole design
//!
//! "Holds the humidity ratio" cannot mean *exactly*, because the two states came
//! from a chart the user dragged. Each tolerance below is therefore an explicit
//! constant with a reason attached, and the fit reports which test it matched so
//! a caller can say "identified as evaporative cooling — the wet bulb held to
//! within 0.05 K" rather than asserting a classification the reader has to take
//! on trust.
//!
//! A pair that matches nothing is [`Fit::General`], not a guess. A tool that
//! forces every line into a named category teaches a vocabulary that does not
//! exist, and the honest answer for an arbitrary chord is its load and its slope.

use crate::coil::{self, Coil};
use crate::process::{self, Load};
use crate::state::{Atmosphere, StatePoint};

/// Humidity ratios closer than this are the same humidity ratio, kg/kg_da.
///
/// 0.01 g/kg. Two orders of magnitude below the width of a chart's finest
/// gridline, and comfortably below what a drag can resolve: a "horizontal"
/// process the user drew by eye lands well inside it, and a real
/// humidification step — the smallest useful being about 0.5 g/kg — lands well
/// outside.
pub const W_TOLERANCE: f64 = 1.0e-5;

/// Temperatures closer than this are the same temperature, K.
///
/// Half of the finest dry-bulb gridline a chart draws. Used for the degenerate
/// guards rather than for classification — a saturated inlet has no wet-bulb
/// depression to take a fraction of, and this is how that is recognised.
pub const T_TOLERANCE: f64 = 0.05;

/// The enthalpy-per-moisture band an injection of water *vapour* falls in,
/// kJ/kg_wv.
///
/// This, and not a dry-bulb tolerance, is how steam humidification is
/// recognised. §4.3 calls the process "near-vertical", and near is the operative
/// word: 3 g/kg of dry saturated steam at 100 °C into 20 °C air moves the dry
/// bulb 0.4 K, which is eight times any tolerance worth calling isothermal. What
/// the process does hold is its *slope*, `Δh/ΔW = h_g` of the injected steam,
/// and that is a number with a physical range — around 2500 kJ/kg for saturated
/// steam at atmospheric pressure, higher for the superheat an electrode cylinder
/// delivers.
///
/// The band is wide because it only has to separate steam from the one other
/// thing that adds moisture: evaporative humidification carries the enthalpy of
/// liquid water at the wet bulb, some 40–80 kJ/kg. There is nothing between
/// them to confuse it with.
pub const STEAM_SLOPE: std::ops::RangeInclusive<f64> = 2_000.0..=3_400.0;

/// Wet-bulb temperatures closer than this are the same wet bulb, K.
///
/// The same figure as [`T_TOLERANCE`], and deliberately not looser: an
/// evaporative process that misses constant wet-bulb by more than this is
/// something else — a spray coil with a load on it, most often — and calling it
/// adiabatic would hide the load.
pub const WB_TOLERANCE: f64 = 0.05;

/// What the pair of states turned out to be.
///
/// Each variant carries the parameters that *define* that process, in SI, so a
/// caller can turn the fit straight into a parametric process rather than
/// re-deriving them.
#[derive(Debug, Clone)]
pub enum Fit {
    /// Humidity ratio held, dry bulb up.
    SensibleHeating {
        /// Duty, kW. Positive.
        duty: f64,
    },
    /// Humidity ratio held, dry bulb down — a dry coil.
    SensibleCooling {
        /// Duty, kW. Negative, because the air lost energy.
        duty: f64,
    },
    /// Dry bulb held, moisture added: steam or another isothermal injection.
    Isothermal {
        /// Water injected, kg/s. `ṁ_da·(W_out − W_in)`.
        steam_flow: f64,
        /// The enthalpy the injected steam must have carried, kJ/kg.
        ///
        /// `Δh/ΔW`, which is the process slope. Recovering it is the point:
        /// dry saturated steam at 100 °C is 2676 kJ/kg, and a number far from
        /// it means the line is not really an isothermal injection.
        steam_enthalpy: f64,
    },
    /// Wet bulb held, moisture added: adiabatic humidification.
    Evaporative {
        /// Saturation effectiveness, `ε = (t_in − t_out)/(t_in − t_wb,in)`.
        effectiveness: f64,
        /// Water evaporated, kg/s.
        water_flow: f64,
    },
    /// Moisture removed and the air cooled: a wet coil.
    CoolingDehumidification {
        /// The coil the two states describe, ADP and bypass factors included.
        ///
        /// Boxed because a [`Coil`] carries three resolved states and their
        /// atmospheres, which is an order of magnitude larger than any other
        /// variant here; inline it would make every fit pay for the one case.
        coil: Box<Coil>,
    },
    /// Moisture removed and the air warmed: a desiccant.
    Desiccant {
        /// Water removed from the airstream, kg/s.
        water_removed: f64,
        /// How far the process departed from constant enthalpy, kJ/kg.
        ///
        /// Zero is the ideal isenthalpic sorption of §4.4. A positive value is
        /// the regeneration heat that came across with it.
        enthalpy_rise: f64,
    },
    /// A chord that matches no named process.
    ///
    /// Not a failure. Heating with humidification, a coil with reheat rolled
    /// into one line, or a state the user dragged somewhere arbitrary all land
    /// here, and the load and the slope are the true answer for them.
    General,
}

/// A classified process: what it is, what it moved, and what it slopes at.
#[derive(Debug, Clone)]
pub struct ProcessFit {
    /// The identification and its parameters.
    pub fit: Fit,
    /// What the process moved, on the §4.9 decomposition.
    pub load: Load,
    /// Enthalpy per unit moisture, kJ/kg_wv, or `None` when no moisture moved.
    ///
    /// The protractor's own scale. `None` is the fully sensible case, where the
    /// slope is infinite and the line is horizontal — a real design rather than
    /// a degenerate one.
    pub slope: Option<f64>,
}

/// Identifies the process between two states.
///
/// `mdot_da` is **dry-air** mass flow, `V̇ / v_da`. It scales the flows and
/// duties reported but never the classification, which is a question about the
/// two states alone.
///
/// It cannot fail. Every pair of resolved states is *something* — at worst a
/// [`Fit::General`] chord with a load and a slope — and a classifier that
/// returns an error for an ordinary line the user drew would be a classifier
/// nobody could call on a drag.
#[must_use]
pub fn identify(
    inlet: &StatePoint,
    outlet: &StatePoint,
    mdot_da: f64,
    atm: &Atmosphere,
) -> ProcessFit {
    let load = process::load(inlet, outlet, mdot_da);
    let dw = outlet.w - inlet.w;
    let dt = outlet.t_db - inlet.t_db;
    let dh = outlet.h - inlet.h;

    let slope = if dw.abs() > f64::EPSILON {
        Some(dh / dw)
    } else {
        None
    };

    let fit = if dw.abs() < W_TOLERANCE {
        // Moisture held. The dry family, and the only one where the sign of Δt
        // is the whole classification.
        if dt >= 0.0 {
            Fit::SensibleHeating { duty: load.total }
        } else {
            Fit::SensibleCooling { duty: load.total }
        }
    } else if dw > 0.0 {
        // Moisture added. The wet bulb is tested first because it is the
        // stronger statement: a process that holds it is adiabatic, and its
        // slope falls nowhere near the vapour band below.
        let depression = inlet.t_db - inlet.t_wb;
        if (outlet.t_wb - inlet.t_wb).abs() < WB_TOLERANCE && depression.abs() >= T_TOLERANCE {
            Fit::Evaporative {
                effectiveness: (inlet.t_db - outlet.t_db) / depression,
                water_flow: mdot_da * dw,
            }
        } else if slope.is_some_and(|s| STEAM_SLOPE.contains(&s)) {
            Fit::Isothermal {
                steam_flow: mdot_da * dw,
                // The slope *is* the enthalpy of what was injected, which is
                // why recovering it is worth doing: a value near 2676 kJ/kg is
                // dry saturated steam at 100 °C, and one far from it says the
                // line is not really an injection.
                steam_enthalpy: dh / dw,
            }
        } else {
            Fit::General
        }
    } else if dt < 0.0 && dh < 0.0 {
        // Moisture removed and the air cooled: a coil, and the construction that
        // sizes it. Reusing `from_leaving` rather than re-deriving means the ADP
        // a fit reports and the ADP the Process Design page reports come from one
        // place.
        //
        // A chord whose extension never meets saturation is not a coil, whatever
        // its direction — dehumidification followed by reheat, rolled into one
        // line, is the usual way to draw one. That is a `General` chord rather
        // than an error: the load and the slope are still true.
        match coil::from_leaving(inlet, outlet, mdot_da, atm) {
            Ok(coil) => Fit::CoolingDehumidification {
                coil: Box::new(coil),
            },
            Err(_) => Fit::General,
        }
    } else if dt > 0.0 {
        // Moisture removed and the air warmed: the desiccant direction. The
        // enthalpy rise comes back alongside because it is what distinguishes a
        // wheel from a coil with reheat behind it — §4.4's ideal sorption holds
        // enthalpy, and a large rise says something else is going on.
        Fit::Desiccant {
            water_removed: -mdot_da * dw,
            enthalpy_rise: dh,
        }
    } else {
        Fit::General
    };

    ProcessFit { fit, load, slope }
}
