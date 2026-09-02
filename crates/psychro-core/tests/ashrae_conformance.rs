//! Conformance tests against published ASHRAE / IAPWS reference values.
//!
//! Written to be independent of whichever library computes the properties, and
//! now cashing that in: every `StatePoint` here is resolved by **frees**, while
//! the free functions grade this crate's own reference formulations. Both are
//! held to the same published numbers.
//!
//! They pin the mistakes that are easy to make silently — a Magnus fit extended
//! below freezing, the older `2501`/`1.86` enthalpy constants, or relative
//! humidity conflated with degree of saturation.

use approx::assert_relative_eq;
use psychro_core::constants::P_STD;
use psychro_core::saturation::{p_ws, p_ws_ice, p_ws_liquid, t_sat};
use psychro_core::state::{
    degree_of_saturation, dry_air_mass_flow, enthalpy, humidity_ratio_from_p_wv,
    pressure_from_altitude, relative_humidity, specific_volume, temperature_from_enthalpy,
    Atmosphere, StatePoint,
};

/// IAPWS-IF97 saturation line over liquid water at the triple point and above.
#[test]
fn saturation_pressure_over_water_matches_iapws() {
    // IAPWS-IF97 reference values, Pa.
    assert_relative_eq!(p_ws_liquid(0.0), 611.213, max_relative = 1e-4);
    assert_relative_eq!(p_ws_liquid(20.0), 2339.21, max_relative = 1e-4);
    assert_relative_eq!(p_ws_liquid(50.0), 12351.27, max_relative = 1e-4);
    assert_relative_eq!(p_ws_liquid(100.0), 101_417.98, max_relative = 1e-4);
}

/// IAPWS-06 sublimation line over ice.
#[test]
fn saturation_pressure_over_ice_matches_iapws() {
    assert_relative_eq!(p_ws_ice(0.0), 611.15, max_relative = 1e-3);
    assert_relative_eq!(p_ws_ice(-10.0), 259.874, max_relative = 1e-3);
    assert_relative_eq!(p_ws_ice(-20.0), 103.239, max_relative = 1e-3);
    assert_relative_eq!(p_ws_ice(-40.0), 12.842, max_relative = 1e-3);
}

/// A Magnus/Antoine fit carried below freezing is badly wrong; the ice branch is
/// not optional. This pins the magnitude so nobody "simplifies" it away.
#[test]
fn ice_branch_differs_sharply_from_a_liquid_fit() {
    let magnus = |t: f64| 610.94 * (17.625 * t / (t + 243.04)).exp();
    let err = (magnus(-20.0) - p_ws(-20.0)) / p_ws(-20.0);
    assert!(
        err > 0.20,
        "expected a liquid-only fit to overstate ice saturation by >20% at -20 C, got {:.1}%",
        err * 100.0
    );
    // ...while agreeing closely above freezing.
    let err_warm = ((magnus(24.0) - p_ws(24.0)) / p_ws(24.0)).abs();
    assert!(err_warm < 0.005);
}

/// Saturation inversion round-trips, across both phases.
#[test]
fn t_sat_inverts_p_ws() {
    for t in [-40.0, -20.0, -5.0, 0.0, 10.0, 24.0, 50.0, 80.0] {
        let back = t_sat(p_ws(t)).expect("within bracket");
        assert_relative_eq!(back, t, epsilon = 1e-6);
    }
}

/// ASHRAE Handbook—Fundamentals Ch. 1, Table 2 (sea level, 25 °C saturated).
#[test]
fn saturated_air_at_25c_sea_level() {
    let p = Atmosphere::sea_level();
    let s = StatePoint::from_db_rh(25.0, 1.0, &p).unwrap();
    assert_relative_eq!(s.w, 0.020_173, max_relative = 2e-3);
    assert_relative_eq!(s.h, 76.53, max_relative = 3e-3);
    assert_relative_eq!(s.v, 0.8721, max_relative = 2e-3);
    // At saturation, relative humidity and degree of saturation coincide.
    assert_relative_eq!(s.rh, s.mu, max_relative = 1e-6);
    assert_relative_eq!(s.t_wb, 25.0, epsilon = 1e-3);
    assert_relative_eq!(s.t_dp, 25.0, epsilon = 1e-3);
}

/// The RP-1485 enthalpy constants, pinned. Using 2501/1.86 fails this.
#[test]
fn enthalpy_uses_rp1485_constants() {
    // h = 1.006*t + W*(2499.86 + 1.84*t)
    assert_relative_eq!(enthalpy(0.0, 0.0), 0.0, epsilon = 1e-12);
    assert_relative_eq!(enthalpy(0.0, 0.010), 24.9986, epsilon = 1e-9);
    assert_relative_eq!(enthalpy(30.0, 0.0), 30.18, epsilon = 1e-9);
    let legacy = 1.006 * 30.0 + 0.010 * (2501.0 + 1.86 * 30.0);
    assert!((enthalpy(30.0, 0.010) - legacy).abs() > 0.005);
}

/// Enthalpy inverts back to dry-bulb temperature.
#[test]
fn enthalpy_inverts_to_temperature() {
    for (t, w) in [(24.0, 0.0093), (-5.0, 0.002), (40.0, 0.020)] {
        assert_relative_eq!(
            temperature_from_enthalpy(enthalpy(t, w), w),
            t,
            epsilon = 1e-9
        );
    }
}

/// Relative humidity is a pressure ratio and degree of saturation is a mass
/// ratio; they must not be equal in the mid-range.
#[test]
fn relative_humidity_is_not_degree_of_saturation() {
    let p = Atmosphere::sea_level();
    let s = StatePoint::from_db_rh(24.0, 0.50, &p).unwrap();

    // As the backend resolves them: RH comes back as asked, and mu is a
    // measurably different number.
    assert_relative_eq!(s.rh, 0.50, max_relative = 1e-9);
    assert!(s.mu < 0.50, "degree of saturation should sit below RH here");
    assert!(
        (0.50 - s.mu) > 0.005,
        "expected a separation of over half a point, got {:.4}",
        0.50 - s.mu
    );

    // And the reference implementation agrees on the distinction, independently.
    // Graded against itself, not against the backend: the two differ by ~1e-4
    // relative, which `tests/frees_backend_parity.rs` measures deliberately.
    let w_ref = humidity_ratio_from_p_wv(0.50 * psychro_core::saturation::p_ws(24.0), &p);
    assert_relative_eq!(
        relative_humidity(24.0, w_ref, &p),
        0.50,
        max_relative = 1e-9
    );
    assert!(degree_of_saturation(24.0, w_ref, &p) < 0.50);
}

/// Wet-bulb round-trips through the above-freezing branch.
#[test]
fn wet_bulb_round_trips_above_freezing() {
    let p = Atmosphere::sea_level();
    let s = StatePoint::from_db_rh(24.0, 0.50, &p).unwrap();
    assert_relative_eq!(s.t_wb, 17.07, epsilon = 0.02);
    let back = StatePoint::from_db_wb(24.0, s.t_wb, &p).unwrap();
    assert_relative_eq!(back.w, s.w, max_relative = 1e-6);
}

/// Wet-bulb round-trips through the sub-freezing (ice) branch.
#[test]
fn wet_bulb_round_trips_below_freezing() {
    let p = Atmosphere::sea_level();
    let s = StatePoint::from_db_rh(-10.0, 0.60, &p).unwrap();
    assert!(s.t_wb < 0.0, "wet bulb should be sub-freezing here");
    let back = StatePoint::from_db_wb(-10.0, s.t_wb, &p).unwrap();
    assert_relative_eq!(back.w, s.w, max_relative = 1e-6);
    // Below freezing the dew point is a frost point on the ice line.
    assert!(s.t_dp < 0.0);
}

/// Dew point round-trips.
#[test]
fn dew_point_round_trips() {
    let p = Atmosphere::sea_level();
    for (t, rh) in [(24.0, 0.50), (35.0, 0.80), (-5.0, 0.70)] {
        let s = StatePoint::from_db_rh(t, rh, &p).unwrap();
        let back = StatePoint::from_db_dp(t, s.t_dp, &p).unwrap();
        assert_relative_eq!(back.w, s.w, max_relative = 1e-6);
    }
}

/// ICAO standard atmosphere, and the altitude sensitivity that makes elevation a
/// required input rather than a refinement.
#[test]
fn altitude_shifts_pressure_and_humidity_ratio() {
    assert_relative_eq!(pressure_from_altitude(0.0), P_STD, max_relative = 1e-9);
    assert_relative_eq!(
        pressure_from_altitude(1500.0),
        84_556.0,
        max_relative = 2e-3
    );

    let sea = StatePoint::from_db_rh(24.0, 0.50, &Atmosphere::sea_level()).unwrap();
    let denver = StatePoint::from_db_rh(24.0, 0.50, &Atmosphere::at_altitude(1609.0)).unwrap();
    let ratio = denver.w / sea.w;
    assert!(
        ratio > 1.15,
        "humidity ratio at 1609 m should exceed sea level by >15%, got {:.1}%",
        (ratio - 1.0) * 100.0
    );
}

/// Specific volume is per kg of dry air, and density is derived from it.
#[test]
fn specific_volume_is_on_a_dry_air_basis() {
    let p = Atmosphere::sea_level();
    let s = StatePoint::from_db_rh(24.0, 0.50, &p).unwrap();

    // Density is derived from the backend's own specific volume, so this is an
    // identity and holds to the last bit.
    assert_relative_eq!(s.rho, (1.0 + s.w) / s.v, max_relative = 1e-12);

    // The reference implementation lands on the same volume to within the
    // measured cross-implementation agreement, not to machine precision.
    assert_relative_eq!(specific_volume(24.0, s.w, &p), s.v, max_relative = 1e-3);

    // Dry-air mass flow from 1 m3/s, versus the wrong moist-air-density route:
    // ~1% apart, which is why the basis has to be stated rather than assumed.
    let m_da = 1.0 / s.v;
    let wrong = 1.0 * s.rho;
    assert!((wrong - m_da) / m_da > 0.009);
    assert_relative_eq!(
        dry_air_mass_flow(1.0, 24.0, s.w, &p),
        m_da,
        max_relative = 1e-3
    );
}

/// Humidity ratio and vapour pressure are mutual inverses.
#[test]
fn humidity_ratio_and_vapour_pressure_round_trip() {
    let p = Atmosphere::sea_level();
    // 0.020 would be above saturation at 24 C (W_s = 0.018965) — not a state.
    for w in [0.001, 0.0093, 0.015] {
        // The reference pair inverts exactly...
        let pv = psychro_core::state::p_wv_from_humidity_ratio(w, &p);
        assert_relative_eq!(humidity_ratio_from_p_wv(pv, &p), w, max_relative = 1e-12);

        // ...and a backend-resolved state carries a vapour pressure consistent
        // with its own humidity ratio, to the cross-implementation tolerance.
        let s = StatePoint::from_db_w(24.0, w, &p).unwrap();
        assert_relative_eq!(humidity_ratio_from_p_wv(s.p_wv, &p), w, max_relative = 1e-3);
    }
}
