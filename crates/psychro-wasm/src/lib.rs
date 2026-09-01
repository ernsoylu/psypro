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

use psychro_core::state::{
    humidity_ratio_from_p_wv, humidity_ratio_from_wet_bulb, pressure_from_altitude, Atmosphere,
    StatePoint,
};
use psychro_core::{saturation::p_ws, units};
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
            let w = humidity_ratio_from_wet_bulb(t_db, t_wb, &atm);
            if w < 0.0 {
                return Err(
                    "that dry-bulb and wet-bulb pair implies a negative humidity ratio".to_string(),
                );
            }
            StatePoint::from_db_w(t_db, w, &atm)
        }
        InputState::DbtDewPoint => {
            let t_dp = to_c(input.val2);
            if t_dp > t_db + 1e-9 {
                return Err("dew point cannot exceed dry-bulb temperature".to_string());
            }
            StatePoint::from_db_dp(t_db, t_dp, &atm)
        }
        InputState::DbtHumidityRatio => {
            if input.val2 < 0.0 {
                return Err("humidity ratio cannot be negative".to_string());
            }
            StatePoint::from_db_w(t_db, input.val2, &atm)
        }
        InputState::DbtEnthalpy => {
            let h = if input.is_si {
                input.val2
            } else {
                units::btu_per_lb_to_kj_per_kg(input.val2)
            };
            // Invert h = cp_da·t + W·(h_g + cp_wv·t) for W at the known t.
            let w = (h - 1.006 * t_db) / (2499.86 + 1.84 * t_db);
            if w < 0.0 {
                return Err(
                    "that enthalpy is below the dry-air value at this temperature".to_string(),
                );
            }
            StatePoint::from_db_w(t_db, w, &atm)
        }
    };

    // Supersaturation is not a valid moist-air state; the fog region is modelled
    // separately and is not yet implemented.
    let w_sat = humidity_ratio_from_p_wv(p_ws(t_db), &atm);
    if point.w > w_sat * (1.0 + 1e-9) {
        return Err(format!(
            "state lies above saturation (W = {:.6} vs W_s = {:.6}); the fog region is not yet modelled",
            point.w, w_sat
        ));
    }
    Ok(point)
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
    let mixed = StatePoint::from_h_w(h, w, &atm);
    Ok(present(&mixed, a.is_si))
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
