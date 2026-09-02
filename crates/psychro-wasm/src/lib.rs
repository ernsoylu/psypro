//! `wasm-bindgen` bridge exposing [`psychro_core`] to TypeScript.
//!
//! This crate contains no thermodynamics of its own. Its only jobs are to
//! translate across the JavaScript boundary, to convert between IP and SI at
//! that boundary, and to emit the TypeScript definitions the frontend consumes.
//! Any calculation added here instead of in `psychro-core` is a bug: it would be
//! unreachable from `cargo test` and invisible to non-browser consumers.
//!
//! Every entry point is stateless. Unit system, altitude and the real-gas
//! treatment travel with each call rather than being configured once, so a
//! result is always reproducible from its inputs alone.

#![deny(unsafe_code)]

use psychro_core::chart::{
    self, ChartDomain, ChartLayout as CoreLayout, ChartPoint, CurveFamily, GridSpec,
};
use psychro_core::process;
use psychro_core::state::{pressure_from_altitude, Atmosphere, StatePoint};
use psychro_core::units;
use wasm_bindgen::prelude::*;

/// Which pair of properties the caller is supplying.
///
/// Dry-bulb temperature is always the first value; this selects what the second
/// one means.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputState {
    /// Second value is thermodynamic wet-bulb temperature.
    DbtWbt,
    /// Second value is relative humidity, as a percentage.
    DbtRh,
    /// Second value is dew-point (or frost-point) temperature.
    DbtDewPoint,
    /// Second value is humidity ratio, mass of vapour per mass of dry air.
    DbtHumidityRatio,
    /// Second value is specific enthalpy.
    DbtEnthalpy,
}

/// The inputs required to resolve one moist-air state point.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct StatePointInput {
    /// Dry-bulb temperature, in °C when `is_si` else °F.
    pub dbt: f64,
    /// The second known property, interpreted according to `state_type`.
    pub val2: f64,
    /// What `val2` means.
    pub state_type: InputState,
    /// Site elevation, in metres when `is_si` else feet.
    pub altitude: f64,
    /// SI units when true, IP units when false.
    pub is_si: bool,
    /// Apply the real-gas enhancement factor.
    ///
    /// True reproduces ASHRAE's published tables. False gives the ideal-gas
    /// treatment, which exists for teaching and is around 0.5% low on humidity
    /// ratio.
    pub real_gas: bool,
}

#[wasm_bindgen]
impl StatePointInput {
    /// Constructs an input set.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(
        dbt: f64,
        val2: f64,
        state_type: InputState,
        altitude: f64,
        is_si: bool,
        real_gas: bool,
    ) -> Self {
        Self {
            dbt,
            val2,
            state_type,
            altitude,
            is_si,
            real_gas,
        }
    }
}

/// A fully resolved state point, in the unit system that was requested.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct StatePointOutput {
    /// Dry-bulb temperature, °C or °F.
    pub dbt: f64,
    /// Thermodynamic wet-bulb temperature, °C or °F.
    pub wbt: f64,
    /// Dew-point or frost-point temperature, °C or °F.
    pub dew_point: f64,
    /// Humidity ratio, kg/kg_da or lb/lb_da (dimensionless either way).
    pub humidity_ratio: f64,
    /// Humidity ratio in grains per pound of dry air, for IP presentation.
    pub humidity_ratio_grains: f64,
    /// Relative humidity as a percentage, `p_wv / p_ws`.
    pub rh: f64,
    /// Degree of saturation as a percentage, `W / W_s`.
    ///
    /// Reported separately from `rh` on purpose: the two are routinely conflated
    /// and agree only at 0% and 100%.
    pub degree_of_saturation: f64,
    /// Specific enthalpy, kJ/kg_da or Btu/lb_da.
    pub enthalpy: f64,
    /// Specific volume per unit mass of dry air, m³/kg_da or ft³/lb_da.
    pub specific_volume: f64,
    /// Moist-air density, kg/m³ or lb/ft³.
    ///
    /// Reported for reference only. Mass balances must divide volumetric flow by
    /// `specific_volume`; dry-air mass is what is conserved across a process.
    pub density: f64,
    /// Water-vapour partial pressure, kPa or psi.
    pub vapor_pressure: f64,
    /// Barometric pressure the state was resolved at, kPa or psi.
    pub barometric_pressure: f64,
    /// True when the state lies below freezing, so ice-side formulations applied.
    pub is_sub_freezing: bool,
}

/// Resolves the atmosphere for a set of inputs.
fn atmosphere_for(input: &StatePointInput) -> Atmosphere {
    let altitude_m = if input.is_si {
        input.altitude
    } else {
        units::ft_to_m(input.altitude)
    };
    Atmosphere {
        p_bar: pressure_from_altitude(altitude_m),
        real_gas: input.real_gas,
    }
}

/// Converts a resolved SI state point into the caller's unit system.
fn present(s: &StatePoint, is_si: bool) -> StatePointOutput {
    let (dbt, wbt, dew_point) = if is_si {
        (s.t_db, s.t_wb, s.t_dp)
    } else {
        (
            units::c_to_f(s.t_db),
            units::c_to_f(s.t_wb),
            units::c_to_f(s.t_dp),
        )
    };
    StatePointOutput {
        dbt,
        wbt,
        dew_point,
        humidity_ratio: s.w,
        humidity_ratio_grains: units::humidity_ratio_to_grains(s.w),
        rh: s.rh * 100.0,
        degree_of_saturation: s.mu * 100.0,
        enthalpy: if is_si {
            s.h
        } else {
            units::kj_per_kg_to_btu_per_lb(s.h)
        },
        specific_volume: if is_si {
            s.v
        } else {
            units::m3_per_kg_to_ft3_per_lb(s.v)
        },
        density: if is_si {
            s.rho
        } else {
            units::kg_per_m3_to_lb_per_ft3(s.rho)
        },
        vapor_pressure: if is_si {
            s.p_wv / 1000.0
        } else {
            units::pa_to_psi(s.p_wv)
        },
        barometric_pressure: if is_si {
            s.atm.p_bar / 1000.0
        } else {
            units::pa_to_psi(s.atm.p_bar)
        },
        is_sub_freezing: s.t_db < 0.0,
    }
}

/// Resolves the SI state point for a set of inputs, or an error message.
///
/// The checks here exist to give a *better* message than the layer below, not a
/// different verdict. `psychro_core::StatePoint` refuses supersaturated states
/// itself, so this function no longer duplicates that check — it only catches
/// the input combinations where naming the offending field is more useful than
/// reporting the saturation violation it would cause.
fn resolve(input: &StatePointInput) -> Result<StatePoint, String> {
    let atm = atmosphere_for(input);
    let to_c = |t: f64| if input.is_si { t } else { units::f_to_c(t) };
    let t_db = to_c(input.dbt);

    let point = match input.state_type {
        InputState::DbtRh => {
            let rh = input.val2 / 100.0;
            if !(0.0..=1.0).contains(&rh) {
                return Err(format!(
                    "relative humidity must be between 0 and 100%, got {}",
                    input.val2
                ));
            }
            StatePoint::from_db_rh(t_db, rh, &atm)
        }
        InputState::DbtWbt => {
            let t_wb = to_c(input.val2);
            if t_wb > t_db + 1e-9 {
                return Err("wet-bulb temperature cannot exceed dry-bulb temperature".to_string());
            }
            StatePoint::from_db_wb(t_db, t_wb, &atm)
        }
        InputState::DbtDewPoint => {
            let t_dp = to_c(input.val2);
            if t_dp > t_db + 1e-9 {
                return Err("dew point cannot exceed dry-bulb temperature".to_string());
            }
            StatePoint::from_db_dp(t_db, t_dp, &atm)
        }
        InputState::DbtHumidityRatio => StatePoint::from_db_w(t_db, input.val2, &atm),
        InputState::DbtEnthalpy => {
            let h = if input.is_si {
                input.val2
            } else {
                units::btu_per_lb_to_kj_per_kg(input.val2)
            };
            StatePoint::from_h_w(h, backend_w_from_enthalpy(t_db, h, &atm)?, &atm)
        }
    };
    point.map_err(|e| e.message().to_string())
}

/// Humidity ratio implied by a dry-bulb temperature and an enthalpy.
///
/// Asked of the backend rather than inverted here, so the enthalpy relation is
/// the backend's everywhere and this crate holds no second copy of it.
fn backend_w_from_enthalpy(t_db: f64, h: f64, atm: &Atmosphere) -> Result<f64, String> {
    psychro_core::backend::humidity_ratio_from_enthalpy(t_db, h, atm.p_bar)
        .map_err(|e| e.message().to_string())
}

/// Resolves every psychrometric property of one moist-air state point.
///
/// Returns a JavaScript `Error` describing the problem when the inputs do not
/// describe a physically valid state.
#[wasm_bindgen]
pub fn calculate_state(input: StatePointInput) -> Result<StatePointOutput, JsValue> {
    resolve(&input)
        .map(|s| present(&s, input.is_si))
        .map_err(|e| JsValue::from_str(&e))
}

/// Adiabatically mixes two air streams on a dry-air mass basis.
///
/// `fraction_a` is stream A's share of the total dry-air mass flow, 0 to 1.
/// Mixing conserves dry-air mass, moisture and energy, so the mixed state is the
/// mass-weighted mean of humidity ratio and enthalpy — never of temperature.
#[wasm_bindgen]
pub fn mix_air(
    a: StatePointInput,
    b: StatePointInput,
    fraction_a: f64,
) -> Result<StatePointOutput, JsValue> {
    if !(0.0..=1.0).contains(&fraction_a) {
        return Err(JsValue::from_str("mixing fraction must be between 0 and 1"));
    }
    if a.is_si != b.is_si {
        return Err(JsValue::from_str(
            "both streams must use the same unit system",
        ));
    }
    let sa = resolve(&a).map_err(|e| JsValue::from_str(&e))?;
    let sb = resolve(&b).map_err(|e| JsValue::from_str(&e))?;
    let f = fraction_a;
    let w = f * sa.w + (1.0 - f) * sb.w;
    let h = f * sa.h + (1.0 - f) * sb.h;
    let atm = atmosphere_for(&a);
    let mixed = StatePoint::from_h_w(h, w, &atm).map_err(|e| JsValue::from_str(e.message()))?;
    Ok(present(&mixed, a.is_si))
}

// ── Processes ───────────────────────────────────────────────────────────────

/// What a process moved, in the unit system that was requested.
///
/// Loads are in kW or Btu/h and mass flows in kg/s or lb/h. Unit handling lives
/// at this boundary and nowhere else, so a caller never has to know which system
/// the engine works in.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct LoadOutput {
    /// Total load. Positive when the process adds energy to the air.
    pub total: f64,
    /// Sensible load.
    pub sensible: f64,
    /// Latent load.
    pub latent: f64,
    /// Moisture added; negative for dehumidification.
    pub moisture: f64,
    /// Sensible heat ratio, `q_s / q_t`.
    ///
    /// `NaN` when the process moves no energy at all, which is the honest answer
    /// — a ratio of zero to zero is not zero, and reporting `0` would be a
    /// number a reader would believe.
    pub shr: f64,
    /// Whether `shr` carries a value.
    pub has_shr: bool,
}

/// A resolved process: where the air ends up, and what it cost.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct ProcessOutput {
    /// The state the air leaves in.
    pub outlet: StatePointOutput,
    /// What the process moved.
    pub load: LoadOutput,
    /// Whether the outlet sits close enough to saturation to need a second look.
    ///
    /// `REQUIREMENTS.md` §4.1 puts the practical limit of a "sensible-only"
    /// process at about 85% RH. Past that, condensation begins and the
    /// horizontal line the chart draws is a fiction.
    pub near_saturation: bool,
}

/// Converts a core load into the requested unit system.
fn present_load(load: &process::Load, is_si: bool) -> LoadOutput {
    let power = |q: f64| {
        if is_si {
            q
        } else {
            units::kw_to_btu_per_hour(q)
        }
    };
    let flow = |m: f64| {
        if is_si {
            m
        } else {
            units::kg_per_second_to_lb_per_hour(m)
        }
    };
    LoadOutput {
        total: power(load.total),
        sensible: power(load.sensible),
        latent: power(load.latent),
        moisture: flow(load.moisture),
        shr: load.shr.unwrap_or(f64::NAN),
        has_shr: load.shr.is_some(),
    }
}

/// Wraps a core process result for the boundary.
fn present_process(r: &process::ProcessResult, is_si: bool) -> ProcessOutput {
    ProcessOutput {
        outlet: present(&r.outlet, is_si),
        load: present_load(&r.load, is_si),
        near_saturation: r.near_saturation,
    }
}

/// Dry-air mass flow in kg/s, whatever the caller expressed it in.
fn mass_flow_si(mdot_da: f64, is_si: bool) -> f64 {
    if is_si {
        mdot_da
    } else {
        units::lb_per_hour_to_kg_per_second(mdot_da)
    }
}

/// The energy and moisture moved between two states.
///
/// The general case: draw a line between any two points and read what it costs.
/// `mdot_da` is **dry-air** mass flow — `V̇ / v_da`, never `V̇ · ρ_moist`.
#[wasm_bindgen]
pub fn process_load(
    from: StatePointInput,
    to: StatePointInput,
    mdot_da: f64,
) -> Result<LoadOutput, JsValue> {
    let a = resolve(&from).map_err(|e| JsValue::from_str(&e))?;
    let b = resolve(&to).map_err(|e| JsValue::from_str(&e))?;
    let l = process::load(&a, &b, mass_flow_si(mdot_da, from.is_si));
    Ok(present_load(&l, from.is_si))
}

/// Sensible heating or cooling to a target dry-bulb temperature.
///
/// Horizontal on the chart. A load that is entirely sensible — SHR = 1.0, the
/// data-centre case — is the normal use of this, not a degenerate one.
#[wasm_bindgen]
pub fn apply_sensible(
    inlet: StatePointInput,
    t_out: f64,
    mdot_da: f64,
) -> Result<ProcessOutput, JsValue> {
    let s = resolve(&inlet).map_err(|e| JsValue::from_str(&e))?;
    let target = if inlet.is_si {
        t_out
    } else {
        units::f_to_c(t_out)
    };
    let r = process::sensible_to(
        &s,
        target,
        mass_flow_si(mdot_da, inlet.is_si),
        &atmosphere_for(&inlet),
    )
    .map_err(|e| JsValue::from_str(e.message()))?;
    Ok(present_process(&r, inlet.is_si))
}

/// Sensible heating or cooling by a duty rather than to a temperature.
///
/// `q` is in kW or Btu/h, positive for heating: a reheat coil specified by its
/// rating lands where the chart says it does.
#[wasm_bindgen]
pub fn apply_sensible_duty(
    inlet: StatePointInput,
    q: f64,
    mdot_da: f64,
) -> Result<ProcessOutput, JsValue> {
    let s = resolve(&inlet).map_err(|e| JsValue::from_str(&e))?;
    let q_kw = if inlet.is_si {
        q
    } else {
        units::btu_per_hour_to_kw(q)
    };
    let r = process::sensible_duty(
        &s,
        q_kw,
        mass_flow_si(mdot_da, inlet.is_si),
        &atmosphere_for(&inlet),
    )
    .map_err(|e| JsValue::from_str(e.message()))?;
    Ok(present_process(&r, inlet.is_si))
}

/// Steam (isothermal) humidification to a target humidity ratio.
///
/// `h_steam` is the enthalpy of the injected steam, in kJ/kg or Btu/lb. It is a
/// parameter rather than a constant because dry saturated steam at 100 °C and
/// superheated steam from an electrode cylinder put the outlet in different
/// places.
#[wasm_bindgen]
pub fn apply_steam_humidification(
    inlet: StatePointInput,
    w_target: f64,
    h_steam: f64,
    mdot_da: f64,
) -> Result<SteamOutput, JsValue> {
    let s = resolve(&inlet).map_err(|e| JsValue::from_str(&e))?;
    let h = if inlet.is_si {
        h_steam
    } else {
        units::btu_per_lb_to_kj_per_kg(h_steam)
    };
    let m = mass_flow_si(mdot_da, inlet.is_si);
    let r = process::steam_humidify(&s, w_target, h, m, &atmosphere_for(&inlet))
        .map_err(|e| JsValue::from_str(e.message()))?;
    Ok(SteamOutput {
        process: present_process(&r.process, inlet.is_si),
        steam_flow: if inlet.is_si {
            r.steam_flow
        } else {
            units::kg_per_second_to_lb_per_hour(r.steam_flow)
        },
    })
}

/// A humidification process and the water it consumed.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct SteamOutput {
    /// Where the air ended up and what it cost.
    pub process: ProcessOutput,
    /// Steam injected, kg/s or lb/h. `ṁ_steam = ṁ_da·(W_out − W_in)`.
    pub steam_flow: f64,
}

/// Evaporative (adiabatic) humidification along a constant wet-bulb line.
///
/// `effectiveness` is the saturation effectiveness
/// `ε = (t_in − t_out)/(t_in − t_wb,in)`. Typical values: air washer with
/// opposed spray banks 0.95–0.98, 300 mm rigid media 0.88–0.91, residential
/// aspen or mesh media 0.50–0.60.
#[wasm_bindgen]
pub fn apply_evaporative(
    inlet: StatePointInput,
    effectiveness: f64,
    mdot_da: f64,
) -> Result<ProcessOutput, JsValue> {
    let s = resolve(&inlet).map_err(|e| JsValue::from_str(&e))?;
    let r = process::evaporative(
        &s,
        effectiveness,
        mass_flow_si(mdot_da, inlet.is_si),
        &atmosphere_for(&inlet),
    )
    .map_err(|e| JsValue::from_str(e.message()))?;
    Ok(present_process(&r, inlet.is_si))
}

/// Air-to-air energy recovery, per ASHRAE Standard 84.
///
/// `eps_sensible` acts on temperature and `eps_latent` on humidity ratio, as two
/// independently measured ratings. Set `eps_latent` to zero for the
/// sensible-only family: fixed plate, heat wheel, heat pipe, run-around loop,
/// thermosiphon.
#[wasm_bindgen]
pub fn apply_energy_recovery(
    supply_in: StatePointInput,
    exhaust_in: StatePointInput,
    eps_sensible: f64,
    eps_latent: f64,
    mdot_da: f64,
) -> Result<ProcessOutput, JsValue> {
    if supply_in.is_si != exhaust_in.is_si {
        return Err(JsValue::from_str(
            "both streams must use the same unit system",
        ));
    }
    let supply = resolve(&supply_in).map_err(|e| JsValue::from_str(&e))?;
    let exhaust = resolve(&exhaust_in).map_err(|e| JsValue::from_str(&e))?;
    let r = process::energy_recovery(
        &supply,
        &exhaust,
        eps_sensible,
        eps_latent,
        mass_flow_si(mdot_da, supply_in.is_si),
        &atmosphere_for(&supply_in),
    )
    .map_err(|e| JsValue::from_str(e.message()))?;
    Ok(present_process(&r, supply_in.is_si))
}

/// Adiabatic mixing of two airstreams on a dry-air mass basis.
///
/// Unlike [`mix_air`], this takes the two mass flows rather than a fraction, and
/// reports the **Winter V** case: when the mix line crosses saturation the
/// mixture fogs, settles on the saturation curve at its own enthalpy, and drops
/// the excess water out. That happens in every cold-climate mixing box, and a
/// tool that returns an error there is refusing to model it.
#[wasm_bindgen]
pub fn apply_mixing(
    a: StatePointInput,
    mdot_a: f64,
    b: StatePointInput,
    mdot_b: f64,
) -> Result<MixOutput, JsValue> {
    if a.is_si != b.is_si {
        return Err(JsValue::from_str(
            "both streams must use the same unit system",
        ));
    }
    let sa = resolve(&a).map_err(|e| JsValue::from_str(&e))?;
    let sb = resolve(&b).map_err(|e| JsValue::from_str(&e))?;
    let ma = mass_flow_si(mdot_a, a.is_si);
    let mb = mass_flow_si(mdot_b, a.is_si);

    match process::mix(&sa, ma, &sb, mb, &atmosphere_for(&a)) {
        process::MixResult::Mixed { outlet, mdot_da } => Ok(MixOutput {
            outlet: present(&outlet, a.is_si),
            mdot_da: if a.is_si {
                mdot_da
            } else {
                units::kg_per_second_to_lb_per_hour(mdot_da)
            },
            fogged: false,
            condensate: 0.0,
        }),
        process::MixResult::WinterV {
            outlet,
            mdot_da,
            condensate,
        } => Ok(MixOutput {
            outlet: present(&outlet, a.is_si),
            mdot_da: if a.is_si {
                mdot_da
            } else {
                units::kg_per_second_to_lb_per_hour(mdot_da)
            },
            fogged: true,
            condensate: if a.is_si {
                condensate
            } else {
                units::kg_per_second_to_lb_per_hour(condensate)
            },
        }),
        process::MixResult::NoFlow => Err(JsValue::from_str("both streams have zero mass flow")),
        process::MixResult::Failed(e) => Err(JsValue::from_str(e.message())),
    }
}

/// A mixed airstream, and whether it fogged getting there.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct MixOutput {
    /// The mixed state.
    pub outlet: StatePointOutput,
    /// Combined dry-air mass flow, kg/s or lb/h.
    pub mdot_da: f64,
    /// Whether the mix line crossed saturation.
    pub fogged: bool,
    /// Water condensed out of the mixture, kg/s or lb/h. Zero unless it fogged.
    pub condensate: f64,
}

/// The enthalpy-to-moisture slope for a sensible heat ratio.
///
/// `Δh/ΔW = 2499.86/(1 − SHR)`. Returns `NaN` at SHR = 1, where the slope is
/// infinite because the process moves no moisture — the data-centre case, drawn
/// as the horizontal line it is.
#[wasm_bindgen]
#[must_use]
pub fn protractor_slope(shr: f64) -> f64 {
    process::protractor::slope_from_shr(shr).unwrap_or(f64::NAN)
}

/// The sensible heat ratio for an enthalpy-to-moisture slope.
///
/// Inverse of [`protractor_slope`]. A zero slope is SHR = 0: all latent, the
/// dehumidification-only vector.
#[wasm_bindgen]
#[must_use]
pub fn protractor_shr(slope: f64) -> f64 {
    process::protractor::shr_from_slope(slope).unwrap_or(f64::NAN)
}

// ── Coils and the design derivation ─────────────────────────────────────────

/// A cooling coil, as a datasheet would describe it.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct CoilOutput {
    /// Air leaving the coil.
    pub leaving: StatePointOutput,
    /// The apparatus dew point: saturated air at the coil's effective surface.
    pub adp: StatePointOutput,
    /// Bypass factor read on temperature.
    pub bf_temperature: f64,
    /// Bypass factor read on humidity ratio.
    pub bf_humidity_ratio: f64,
    /// Bypass factor read on enthalpy.
    pub bf_enthalpy: f64,
    /// Coil sensible heat ratio, on the air-side enthalpy drop.
    pub shr: f64,
    /// Total load with the condensate credited, kW or Btu/h.
    pub total_load: f64,
    /// The air-side enthalpy drop alone, kW or Btu/h.
    pub air_side_load: f64,
    /// Condensate, kg/s or lb/h.
    pub condensate: f64,
    /// Whether the coil ran dry, so there is no apparatus dew point to speak of.
    pub dry: bool,
}

fn present_coil(c: &psychro_core::coil::Coil, is_si: bool) -> CoilOutput {
    let power = |q: f64| {
        if is_si {
            q
        } else {
            units::kw_to_btu_per_hour(q)
        }
    };
    let flow = |m: f64| {
        if is_si {
            m
        } else {
            units::kg_per_second_to_lb_per_hour(m)
        }
    };
    CoilOutput {
        leaving: present(&c.leaving, is_si),
        adp: present(&c.adp, is_si),
        bf_temperature: c.bf_temperature,
        bf_humidity_ratio: c.bf_humidity_ratio,
        bf_enthalpy: c.bf_enthalpy,
        shr: c.shr,
        total_load: power(c.total_load),
        air_side_load: power(c.air_side_load),
        condensate: flow(c.condensate),
        dry: c.dry,
    }
}

/// Solves a coil from its entering and leaving states.
///
/// The apparatus dew point is the intersection of the extended process line
/// with the saturation curve. All three bypass-factor forms come back so a
/// result can be checked against whichever one a reference uses.
#[wasm_bindgen]
pub fn solve_coil(
    entering: StatePointInput,
    leaving: StatePointInput,
    mdot_da: f64,
) -> Result<CoilOutput, JsValue> {
    if entering.is_si != leaving.is_si {
        return Err(JsValue::from_str(
            "both states must use the same unit system",
        ));
    }
    let a = resolve(&entering).map_err(|e| JsValue::from_str(&e))?;
    let b = resolve(&leaving).map_err(|e| JsValue::from_str(&e))?;
    let c = psychro_core::coil::from_leaving(
        &a,
        &b,
        mass_flow_si(mdot_da, entering.is_si),
        &atmosphere_for(&entering),
    )
    .map_err(|e| JsValue::from_str(e.message()))?;
    Ok(present_coil(&c, entering.is_si))
}

/// Solves a coil forward, from an apparatus dew point and a bypass factor.
///
/// The form a designer selects equipment in: pick a coil, which fixes the ADP,
/// and a face velocity, which fixes the bypass factor.
#[wasm_bindgen]
pub fn solve_coil_from_adp(
    entering: StatePointInput,
    t_adp: f64,
    bypass_factor: f64,
    mdot_da: f64,
) -> Result<CoilOutput, JsValue> {
    let a = resolve(&entering).map_err(|e| JsValue::from_str(&e))?;
    let adp = if entering.is_si {
        t_adp
    } else {
        units::f_to_c(t_adp)
    };
    let c = psychro_core::coil::from_adp(
        &a,
        adp,
        bypass_factor,
        mass_flow_si(mdot_da, entering.is_si),
        &atmosphere_for(&entering),
    )
    .map_err(|e| JsValue::from_str(e.message()))?;
    Ok(present_coil(&c, entering.is_si))
}

/// The supply air condition and flow a room load implies.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct DesignAirOutput {
    /// Room sensible heat ratio.
    pub rshf: f64,
    /// Dry-air mass flow, kg/s or lb/h.
    pub mdot_da: f64,
    /// Volumetric flow at the supply state, m³/s or ft³/min.
    pub volumetric_flow: f64,
    /// The supply state the room condition line reaches.
    pub supply: StatePointOutput,
}

/// Cubic metres per second to cubic feet per minute.
fn m3s_to_cfm(v: f64) -> f64 {
    v * 2_118.880_003
}

/// Derives the supply air condition and flow for a room load.
///
/// `REQUIREMENTS.md` §4.9. The flow is *solved for* rather than taken from the
/// textbook one-shot, so the air it sizes absorbs precisely the stated loads
/// under the same decomposition the panel reports — see `coil::design_air`.
#[wasm_bindgen]
pub fn solve_design_air(
    room: StatePointInput,
    q_sensible: f64,
    q_latent: f64,
    t_supply: f64,
) -> Result<DesignAirOutput, JsValue> {
    let r = resolve(&room).map_err(|e| JsValue::from_str(&e))?;
    let to_kw = |q: f64| {
        if room.is_si {
            q
        } else {
            units::btu_per_hour_to_kw(q)
        }
    };
    let t = if room.is_si {
        t_supply
    } else {
        units::f_to_c(t_supply)
    };
    let d = psychro_core::coil::design_air(
        &r,
        to_kw(q_sensible),
        to_kw(q_latent),
        t,
        &atmosphere_for(&room),
    )
    .map_err(|e| JsValue::from_str(e.message()))?;

    Ok(DesignAirOutput {
        rshf: d.rshf,
        mdot_da: if room.is_si {
            d.mdot_da
        } else {
            units::kg_per_second_to_lb_per_hour(d.mdot_da)
        },
        volumetric_flow: if room.is_si {
            d.volumetric_flow
        } else {
            m3s_to_cfm(d.volumetric_flow)
        },
        supply: present(&d.supply, room.is_si),
    })
}

/// A primary return-air cycle: every intermediate state, plus the coil.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct CycleOutput {
    /// The mixed state entering the coil.
    pub mixed: StatePointOutput,
    /// The state leaving the coil — the supply air.
    pub supply: StatePointOutput,
    /// The coil that produces it.
    pub coil: CoilOutput,
    /// The room's own design derivation.
    pub design: DesignAirOutput,
    /// Outdoor-air dry-air mass flow, kg/s or lb/h.
    pub mdot_outdoor: f64,
    /// Total supply dry-air mass flow, kg/s or lb/h.
    pub mdot_supply: f64,
    /// Whether the mixing line crossed saturation and the mixture fogged.
    pub mixing_fogged: bool,
}

/// Computes the primary return-air cycle in one action.
///
/// Every intermediate state comes back, so each one can be drawn and checked. A
/// macro reporting only the coil load would be faster to write and impossible
/// to trust.
#[wasm_bindgen]
pub fn solve_return_air_cycle(
    outdoor: StatePointInput,
    room: StatePointInput,
    q_sensible: f64,
    q_latent: f64,
    t_supply: f64,
    outdoor_fraction: f64,
) -> Result<CycleOutput, JsValue> {
    if outdoor.is_si != room.is_si {
        return Err(JsValue::from_str(
            "both states must use the same unit system",
        ));
    }
    let is_si = room.is_si;
    let o = resolve(&outdoor).map_err(|e| JsValue::from_str(&e))?;
    let r = resolve(&room).map_err(|e| JsValue::from_str(&e))?;
    let to_kw = |q: f64| {
        if is_si {
            q
        } else {
            units::btu_per_hour_to_kw(q)
        }
    };
    let t = if is_si {
        t_supply
    } else {
        units::f_to_c(t_supply)
    };

    let c = psychro_core::coil::return_air_cycle(
        &o,
        &r,
        to_kw(q_sensible),
        to_kw(q_latent),
        t,
        outdoor_fraction,
        &atmosphere_for(&room),
    )
    .map_err(|e| JsValue::from_str(e.message()))?;

    let flow = |m: f64| {
        if is_si {
            m
        } else {
            units::kg_per_second_to_lb_per_hour(m)
        }
    };
    Ok(CycleOutput {
        mixed: present(&c.mixed, is_si),
        supply: present(&c.supply, is_si),
        coil: present_coil(&c.coil, is_si),
        design: DesignAirOutput {
            rshf: c.design.rshf,
            mdot_da: flow(c.design.mdot_da),
            volumetric_flow: if is_si {
                c.design.volumetric_flow
            } else {
                m3s_to_cfm(c.design.volumetric_flow)
            },
            supply: present(&c.design.supply, is_si),
        },
        mdot_outdoor: flow(c.mdot_outdoor),
        mdot_supply: flow(c.mdot_supply),
        mixing_fogged: c.mixing_fogged,
    })
}

/// Which chart layout coordinates are expressed in.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChartLayout {
    /// ASHRAE format — dry-bulb horizontal, humidity ratio vertical.
    Ashrae,
    /// Mollier i-x diagram — humidity ratio horizontal, enthalpy vertical.
    MollierIx,
}

impl From<ChartLayout> for CoreLayout {
    fn from(l: ChartLayout) -> Self {
        match l {
            ChartLayout::Ashrae => Self::Ashrae,
            ChartLayout::MollierIx => Self::MollierIx,
        }
    }
}

/// A point in chart space.
///
/// Chart space carries no pixels: the view layer owns zoom, pan and the canvas
/// box, and scales these coordinates itself. Keeping the two stages apart is
/// what lets a layout change without touching the renderer.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct Point2D {
    /// Horizontal chart coordinate.
    pub x: f64,
    /// Vertical chart coordinate.
    pub y: f64,
}

/// The chart-space extent of the drawn domain, for the view layer to scale to.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct ChartExtent {
    /// Minimum horizontal coordinate.
    pub x_min: f64,
    /// Maximum horizontal coordinate.
    pub x_max: f64,
    /// Minimum vertical coordinate.
    pub y_min: f64,
    /// Maximum vertical coordinate.
    pub y_max: f64,
}

/// Maps a state point into chart space for the given layout.
#[wasm_bindgen]
pub fn get_coordinate_mapping(
    input: StatePointInput,
    layout: ChartLayout,
) -> Result<Point2D, JsValue> {
    let s = resolve(&input).map_err(|e| JsValue::from_str(&e))?;
    let p = chart::to_chart(s.t_db, s.w, layout.into());
    Ok(Point2D { x: p.x, y: p.y })
}

/// Recovers a full state point from a chart-space coordinate.
///
/// This is the inverse leg of a pointer drag: the view converts screen pixels to
/// chart space, and this turns chart space back into thermodynamics.
#[wasm_bindgen]
pub fn state_from_chart_coordinates(
    x: f64,
    y: f64,
    layout: ChartLayout,
    altitude: f64,
    is_si: bool,
    real_gas: bool,
) -> Result<StatePointOutput, JsValue> {
    let altitude_m = if is_si {
        altitude
    } else {
        units::ft_to_m(altitude)
    };
    let atm = Atmosphere {
        p_bar: pressure_from_altitude(altitude_m),
        real_gas,
    };
    resolve_from_chart(x, y, layout, &atm)
        .map(|s| present(&s, is_si))
        .map_err(|e| JsValue::from_str(&e))
}

/// Recovers a state from a chart-space coordinate, **clamped to saturation**.
///
/// The unclamped [`state_from_chart_coordinates`] is right for a hit test and
/// wrong for a drag. A pointer above the saturation curve is not a state, so the
/// unclamped call correctly refuses it — but a user drags there within seconds of
/// picking up the tool, and a point that stops responding mid-gesture reads as a
/// bug rather than as physics.
///
/// This clamps instead: past saturation the point slides *along* the saturation
/// curve at the dry bulb the pointer is over, which is what every psychrometric
/// tool does and what the boundary means. The clamp lives here rather than in the
/// view because deciding what "the saturated state at this dry bulb" is remains a
/// thermodynamic question, and TypeScript must not answer one.
///
/// `clamped` in the result says whether it bit, so a caller can show that the
/// pointer has left the physical region rather than silently disagreeing with it.
#[wasm_bindgen]
pub fn state_from_chart_coordinates_clamped(
    x: f64,
    y: f64,
    layout: ChartLayout,
    altitude: f64,
    is_si: bool,
    real_gas: bool,
) -> Result<ClampedState, JsValue> {
    let altitude_m = if is_si {
        altitude
    } else {
        units::ft_to_m(altitude)
    };
    let atm = Atmosphere {
        p_bar: pressure_from_altitude(altitude_m),
        real_gas,
    };
    let (t_db, w) = chart::from_chart(ChartPoint { x, y }, layout.into());
    let (state, clamped) = resolve_clamped(t_db, w, &atm).map_err(|e| JsValue::from_str(&e))?;
    Ok(ClampedState {
        state: present(&state, is_si),
        clamped,
    })
}

/// A resolved state, and whether the request had to be pulled back to the
/// physical region to get one.
#[wasm_bindgen]
pub struct ClampedState {
    state: StatePointOutput,
    clamped: bool,
}

#[wasm_bindgen]
impl ClampedState {
    /// The resolved state.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> StatePointOutput {
        self.state
    }

    /// Whether the humidity ratio was pulled down to saturation.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn clamped(&self) -> bool {
        self.clamped
    }
}

/// Resolves `(t_db, W)`, pulling `W` back to the physical range if it has to.
///
/// Natively testable, for the same reason `resolve_from_chart` is: `JsValue`
/// cannot be constructed outside a wasm context.
fn resolve_clamped(
    t_db: f64,
    w: f64,
    atm: &Atmosphere,
) -> Result<(psychro_core::StatePoint, bool), String> {
    match psychro_core::StatePoint::from_db_w(t_db, w, atm) {
        Ok(s) => Ok((s, false)),
        // Not a state: the pointer is above saturation or below zero humidity.
        // Both have an obvious nearest physical point at the same dry bulb.
        Err(_) => {
            let rh = if w < 0.0 { 0.0 } else { 1.0 };
            psychro_core::StatePoint::from_db_rh(t_db, rh, atm)
                .map(|s| (s, true))
                .map_err(|e| e.message().to_string())
        }
    }
}

/// Chart-space point to state, as a natively testable `Result<_, String>`.
///
/// Split out from [`state_from_chart_coordinates`] because `JsValue` cannot be
/// constructed outside a wasm context, so the error paths would be untestable
/// under `cargo test` if they were inlined there.
fn resolve_from_chart(
    x: f64,
    y: f64,
    layout: ChartLayout,
    atm: &Atmosphere,
) -> Result<StatePoint, String> {
    let (t_db, w) = chart::from_chart(ChartPoint { x, y }, layout.into());
    // Negative humidity and supersaturation are both refused by `StatePoint`,
    // so this only forwards the message.
    StatePoint::from_db_w(t_db, w, atm).map_err(|e| e.message().to_string())
}

/// The chart-space extent of a physical domain, in the given layout.
#[wasm_bindgen]
pub fn get_chart_extent(
    t_min: f64,
    t_max: f64,
    w_min: f64,
    w_max: f64,
    layout: ChartLayout,
) -> ChartExtent {
    let b = chart::bounds(
        &ChartDomain {
            t_min,
            t_max,
            w_min,
            w_max,
        },
        layout.into(),
    );
    ChartExtent {
        x_min: b.x_min,
        x_max: b.x_max,
        y_min: b.y_min,
        y_max: b.y_max,
    }
}

/// One constant-property curve, flattened for the renderer.
#[wasm_bindgen]
pub struct ChartCurve {
    family: u8,
    value: f64,
    coords: Vec<f64>,
}

#[wasm_bindgen]
impl ChartCurve {
    /// The curve family, as a [`CurveFamilyId`] discriminant.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn family(&self) -> u8 {
        self.family
    }

    /// The constant value defining the curve, in that family's natural units.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn value(&self) -> f64 {
        self.value
    }

    /// Chart-space coordinates as a flat `[x0, y0, x1, y1, …]` array.
    ///
    /// Flat rather than an array of objects: the base grid is regenerated only
    /// when units, altitude or layout change, but it is large, and one typed
    /// array crosses the boundary far more cheaply than thousands of objects.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn coords(&self) -> Vec<f64> {
        self.coords.clone()
    }
}

/// Stable numeric ids for the curve families, matching [`ChartCurve::family`].
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CurveFamilyId {
    /// Constant dry-bulb temperature.
    DryBulb = 0,
    /// Constant humidity ratio.
    HumidityRatio = 1,
    /// Constant relative humidity, including saturation at 100%.
    RelativeHumidity = 2,
    /// Constant thermodynamic wet-bulb temperature.
    WetBulb = 3,
    /// Constant enthalpy.
    Enthalpy = 4,
    /// Constant specific volume.
    SpecificVolume = 5,
}

const fn family_id(f: CurveFamily) -> u8 {
    match f {
        CurveFamily::DryBulb => 0,
        CurveFamily::HumidityRatio => 1,
        CurveFamily::RelativeHumidity => 2,
        CurveFamily::WetBulb => 3,
        CurveFamily::Enthalpy => 4,
        CurveFamily::SpecificVolume => 5,
    }
}

/// Generates the full base grid for a domain, in chart space.
///
/// This is Layer 0. It depends only on unit system, altitude and layout, so the
/// renderer caches the result and must not call this per frame.
#[wasm_bindgen]
pub fn generate_base_grid(
    t_min: f64,
    t_max: f64,
    w_min: f64,
    w_max: f64,
    layout: ChartLayout,
    altitude_m: f64,
    real_gas: bool,
) -> Vec<ChartCurve> {
    let atm = Atmosphere {
        p_bar: pressure_from_altitude(altitude_m),
        real_gas,
    };
    let domain = ChartDomain {
        t_min,
        t_max,
        w_min,
        w_max,
    };
    chart::generate_grid(&domain, layout.into(), &atm, &GridSpec::default())
        .into_iter()
        .map(|c| ChartCurve {
            family: family_id(c.family),
            value: c.value,
            coords: c.points.iter().flat_map(|p| [p.x, p.y]).collect(),
        })
        .collect()
}

/// Returns the version of the underlying calculation engine.
///
/// Used by the frontend to confirm that the loaded WASM module matches the build
/// it expects, which is the usual cause of stale-artifact bugs.
#[wasm_bindgen]
pub fn engine_version() -> String {
    psychro_core::VERSION.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn si(dbt: f64, val2: f64, state_type: InputState) -> StatePointInput {
        StatePointInput::new(dbt, val2, state_type, 0.0, true, true)
    }

    /// The same physical state expressed in IP must resolve to the same physics.
    /// Unit handling lives only at this boundary, so this is where it can break.
    #[test]
    fn ip_and_si_describe_the_same_state() {
        let a = resolve(&si(24.0, 50.0, InputState::DbtRh)).unwrap();
        let b = resolve(&StatePointInput::new(
            75.2, // 24 °C
            50.0,
            InputState::DbtRh,
            0.0,
            false,
            true,
        ))
        .unwrap();
        assert!((a.w - b.w).abs() < 1e-9, "W: {} vs {}", a.w, b.w);
        assert!((a.h - b.h).abs() < 1e-6, "h: {} vs {}", a.h, b.h);
        assert!((a.t_wb - b.t_wb).abs() < 1e-6);
    }

    /// Presentation converts, it does not recompute.
    #[test]
    fn ip_presentation_round_trips_to_si() {
        let s = resolve(&si(24.0, 50.0, InputState::DbtRh)).unwrap();
        let out_si = present(&s, true);
        let out_ip = present(&s, false);
        assert!((units::f_to_c(out_ip.dbt) - out_si.dbt).abs() < 1e-9);
        assert!((units::btu_per_lb_to_kj_per_kg(out_ip.enthalpy) - out_si.enthalpy).abs() < 1e-6);
        assert!(
            (units::ft3_per_lb_to_m3_per_kg(out_ip.specific_volume) - out_si.specific_volume).abs()
                < 1e-9
        );
        // Humidity ratio is a mass ratio: dimensionless, identical in both systems.
        assert_eq!(out_ip.humidity_ratio, out_si.humidity_ratio);
    }

    /// Every input mode reaches the same state from a different pair.
    #[test]
    fn all_input_modes_agree_on_one_state() {
        let base = resolve(&si(24.0, 50.0, InputState::DbtRh)).unwrap();
        let cases = [
            si(24.0, base.t_wb, InputState::DbtWbt),
            si(24.0, base.t_dp, InputState::DbtDewPoint),
            si(24.0, base.w, InputState::DbtHumidityRatio),
            si(24.0, base.h, InputState::DbtEnthalpy),
        ];
        for c in cases {
            let s = resolve(&c).unwrap();
            assert!(
                (s.w - base.w).abs() < 1e-7,
                "mode {:?} gave W = {}, expected {}",
                c.state_type,
                s.w,
                base.w
            );
        }
    }

    /// Altitude must reach the calculation, not be silently dropped.
    #[test]
    fn altitude_changes_the_result_and_respects_units() {
        let sea = resolve(&si(24.0, 50.0, InputState::DbtRh)).unwrap();
        let high = resolve(&StatePointInput::new(
            24.0,
            50.0,
            InputState::DbtRh,
            1609.0,
            true,
            true,
        ))
        .unwrap();
        assert!(high.w > sea.w * 1.15);
        // 1609 m expressed as 5279 ft must agree.
        let high_ip = resolve(&StatePointInput::new(
            75.2,
            50.0,
            InputState::DbtRh,
            5279.0,
            false,
            true,
        ))
        .unwrap();
        assert!((high.w - high_ip.w).abs() / high.w < 1e-3);
    }

    /// The ideal-gas mode must actually change the answer, or the toggle is a lie.
    #[test]
    fn ideal_gas_mode_differs_from_real_gas() {
        let real = resolve(&si(24.0, 50.0, InputState::DbtRh)).unwrap();
        let ideal = resolve(&StatePointInput::new(
            24.0,
            50.0,
            InputState::DbtRh,
            0.0,
            true,
            false,
        ))
        .unwrap();
        assert!(ideal.w < real.w);
        assert!((real.w - ideal.w) / real.w > 0.003);
    }

    #[test]
    fn invalid_inputs_are_rejected() {
        assert!(resolve(&si(24.0, 150.0, InputState::DbtRh)).is_err());
        assert!(resolve(&si(24.0, -1.0, InputState::DbtRh)).is_err());
        // Wet-bulb above dry-bulb is unphysical.
        assert!(resolve(&si(20.0, 25.0, InputState::DbtWbt)).is_err());
        // Dew point above dry-bulb would be supersaturated.
        assert!(resolve(&si(20.0, 25.0, InputState::DbtDewPoint)).is_err());
        // Humidity ratio above saturation lands in the unmodelled fog region.
        assert!(resolve(&si(20.0, 0.05, InputState::DbtHumidityRatio)).is_err());
    }

    /// Sub-freezing states resolve through the ice branch and are flagged.
    #[test]
    fn sub_freezing_states_are_flagged() {
        let s = resolve(&si(-10.0, 60.0, InputState::DbtRh)).unwrap();
        let out = present(&s, true);
        assert!(out.is_sub_freezing);
        assert!(out.dew_point < 0.0);
        assert!(out.wbt < 0.0);
    }
}

#[cfg(test)]
mod chart_bridge_tests {
    use super::*;

    fn si(dbt: f64, val2: f64, st: InputState) -> StatePointInput {
        StatePointInput::new(dbt, val2, st, 0.0, true, true)
    }

    /// A state maps to chart space and back to the same state, in both layouts.
    /// This is the drag loop, and any asymmetry here makes points slide.
    #[test]
    fn chart_round_trip_through_the_bridge() {
        for layout in [ChartLayout::Ashrae, ChartLayout::MollierIx] {
            let input = si(24.0, 50.0, InputState::DbtRh);
            let p = get_coordinate_mapping(input, layout).unwrap();
            let back = state_from_chart_coordinates(p.x, p.y, layout, 0.0, true, true).unwrap();
            let original = resolve(&input).unwrap();
            assert!((back.dbt - original.t_db).abs() < 1e-9);
            assert!((back.humidity_ratio - original.w).abs() < 1e-12);
        }
    }

    /// Altitude reaches the inverse map too; the same chart point at elevation is
    /// a different state.
    #[test]
    fn inverse_mapping_respects_altitude() {
        let sea = state_from_chart_coordinates(24.5, 0.009, ChartLayout::Ashrae, 0.0, true, true)
            .unwrap();
        let high =
            state_from_chart_coordinates(24.5, 0.009, ChartLayout::Ashrae, 1609.0, true, true)
                .unwrap();
        assert!(
            (sea.dbt - high.dbt).abs() < 1e-9,
            "t comes from geometry alone"
        );
        assert!(
            high.rh < sea.rh,
            "the same W is further from saturation aloft"
        );
    }

    /// Points above saturation are refused rather than silently returned.
    /// The clamp is what makes a drag survive the boundary. Above saturation
    /// there is no state, so the unclamped call correctly refuses; this one
    /// slides the point onto the saturation curve at the same dry bulb, which
    /// is what the boundary means and what every psychrometric tool does.
    #[test]
    fn dragging_past_saturation_slides_along_the_curve() {
        let atm = Atmosphere::sea_level();
        // 30 C dry bulb with W = 0.040 is well above saturation (~0.0273).
        let (state, clamped) = resolve_clamped(30.0, 0.040, &atm).unwrap();
        assert!(clamped, "the request should have been pulled back");
        assert!((state.rh - 1.0).abs() < 1e-9, "rh = {}", state.rh);
        // The dry bulb the pointer was over is preserved: the point slides
        // ALONG the curve rather than jumping to some nearest point on it.
        assert!((state.t_db - 30.0).abs() < 1e-9);
        assert!(state.w < 0.040);
    }

    /// Below zero humidity there is no state either, and the nearest one is the
    /// dry-air line rather than the saturation curve.
    #[test]
    fn dragging_below_the_dry_air_line_clamps_to_it() {
        let atm = Atmosphere::sea_level();
        let (state, clamped) = resolve_clamped(24.0, -0.004, &atm).unwrap();
        assert!(clamped);
        assert!(state.w.abs() < 1e-12, "w = {}", state.w);
        assert!((state.t_db - 24.0).abs() < 1e-9);
    }

    /// A request inside the physical region is passed through untouched, and
    /// says so — a clamp that fired on every drag would be indistinguishable
    /// from one that never fired.
    #[test]
    fn a_physical_request_is_not_clamped() {
        let atm = Atmosphere::sea_level();
        let (state, clamped) = resolve_clamped(24.0, 0.0093, &atm).unwrap();
        assert!(!clamped);
        assert!((state.w - 0.0093).abs() < 1e-12);
    }

    /// The unit system is an input at this boundary and nowhere else, so this
    /// is where a load can come back off by a factor of 3412.
    #[test]
    fn a_load_is_the_same_physics_in_either_unit_system() {
        let atm = Atmosphere::sea_level();
        let inlet = StatePoint::from_db_rh(13.0, 0.90, &atm).unwrap();
        let si = process::sensible_to(&inlet, 23.0, 2.0, &atm).unwrap();
        let si_load = present_load(&si.load, true);
        let ip_load = present_load(&si.load, false);

        assert!((units::btu_per_hour_to_kw(ip_load.total) - si_load.total).abs() < 1e-9);
        assert!(
            (units::lb_per_hour_to_kg_per_second(ip_load.moisture) - si_load.moisture).abs()
                < 1e-12
        );
        // A ratio is a ratio in both systems.
        assert!((ip_load.shr - si_load.shr).abs() < 1e-12);
    }

    /// `mass_flow_si` is the only place a caller's flow is interpreted, so a
    /// round trip through it has to be exact.
    #[test]
    fn mass_flow_round_trips_through_the_boundary() {
        let si = mass_flow_si(2.0, true);
        assert!((si - 2.0).abs() < 1e-12);
        let from_ip = mass_flow_si(units::kg_per_second_to_lb_per_hour(2.0), false);
        assert!((from_ip - 2.0).abs() < 1e-9, "got {from_ip}");
    }

    /// SHR has no value when a process moves no energy, and `has_shr` is how a
    /// caller finds out — a `NaN` that silently formats as "NaN" in a panel is
    /// worse than an explicit absence.
    #[test]
    fn a_zero_load_reports_no_sensible_heat_ratio() {
        let atm = Atmosphere::sea_level();
        let s = StatePoint::from_db_rh(24.0, 0.5, &atm).unwrap();
        let out = present_load(&process::load(&s, &s, 1.0), true);
        assert!(!out.has_shr);
        assert!(out.shr.is_nan());
        assert!(out.total.abs() < 1e-12);
    }

    #[test]
    fn inverse_mapping_rejects_supersaturated_points() {
        let atm = Atmosphere::sea_level();
        assert!(resolve_from_chart(5.0, 0.02, ChartLayout::Ashrae, &atm).is_err());
        assert!(resolve_from_chart(20.0, -0.001, ChartLayout::Ashrae, &atm).is_err());
        // ...and a physical point still resolves.
        assert!(resolve_from_chart(24.5, 0.009, ChartLayout::Ashrae, &atm).is_ok());
    }

    /// The grid arrives flattened, tagged by family, with straight families
    /// carrying exactly two points (four coordinates).
    #[test]
    fn base_grid_is_flat_and_tagged() {
        let curves = generate_base_grid(-10.0, 50.0, 0.0, 0.030, ChartLayout::Ashrae, 0.0, true);
        assert!(!curves.is_empty());
        for c in &curves {
            assert_eq!(c.coords.len() % 2, 0, "coords must be x,y pairs");
            assert!(c.coords.len() >= 4);
            if matches!(c.family, 0 | 1 | 4) {
                assert_eq!(
                    c.coords.len(),
                    4,
                    "straight family {} needs endpoints only",
                    c.family
                );
            }
        }
        for id in 0..=5u8 {
            assert!(curves.iter().any(|c| c.family == id), "missing family {id}");
        }
    }

    /// The extent encloses the mapped domain corners.
    ///
    /// Geometric, so it uses the core mapping directly: a domain corner such as
    /// −10 °C at W = 0.030 is far above saturation and is not a state, but the
    /// chart still has to reserve space for it.
    #[test]
    fn extent_encloses_the_domain() {
        for layout in [ChartLayout::Ashrae, ChartLayout::MollierIx] {
            let e = get_chart_extent(-10.0, 50.0, 0.0, 0.030, layout);
            for (t, w) in [(-10.0, 0.0), (50.0, 0.0), (-10.0, 0.030), (50.0, 0.030)] {
                let p = chart::to_chart(t, w, layout.into());
                assert!(p.x >= e.x_min - 1e-9 && p.x <= e.x_max + 1e-9);
                assert!(p.y >= e.y_min - 1e-9 && p.y <= e.y_max + 1e-9);
            }
        }
    }
}
