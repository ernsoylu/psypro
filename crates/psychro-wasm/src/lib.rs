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
    if w < 0.0 {
        return Err("humidity ratio cannot be negative".to_string());
    }
    let w_sat = humidity_ratio_from_p_wv(p_ws(t_db), atm);
    if w > w_sat * (1.0 + 1e-9) {
        return Err(
            "that point lies above saturation; the fog region is not yet modelled".to_string(),
        );
    }
    Ok(StatePoint::from_db_w(t_db, w, atm))
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
