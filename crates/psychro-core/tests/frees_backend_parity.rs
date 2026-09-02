//! Holds this crate's reference formulations and the frees backend against each
//! other.
//!
//! Since the backend swap, `StatePoint` *is* the frees path, so grading it
//! against frees would be tautological. What is graded here is the pair that can
//! still disagree: the IAPWS/RP-1485 functions in `state` and `saturation`
//! against `backend`, which is the adapter over `HAPropsSI`.
//!
//! Two things this catches that nothing else would:
//!
//! * A **unit slip in the adapter** — frees speaks kelvin and J/kg, this crate
//!   speaks °C and kJ/kg, and every conversion happens in `backend`. A factor of
//!   1000 or a missing 273.15 would sail through the conformance suite, because
//!   that suite grades the backend against published values with tolerances wide
//!   enough to hide neither but narrow enough to hide a sign.
//! * **Drift in either implementation**, in whichever direction. The recorded
//!   agreement below is the measurement, not an aspiration: if it widens, one of
//!   the two changed.
//!
//! frees is the authority. These bounds are the *observed* separation, and the
//! residual is this crate's linearised enhancement factor against rustprop's
//! full treatment.

use psychro_core::backend;
use psychro_core::constants::P_STD;
use psychro_core::state as reference;
use psychro_core::state::Atmosphere;

/// The reference implementation's atmosphere, at sea level with the real-gas
/// treatment on — the configuration that corresponds to what frees computes.
fn atm() -> Atmosphere {
    Atmosphere::sea_level()
}

#[test]
fn the_backend_is_installed_and_names_itself() {
    let d = backend::description();
    assert!(!d.is_empty());
    assert!(
        d.to_lowercase().contains("rustprop") || d.to_lowercase().contains("coolprop"),
        "unexpected backend: {d}"
    );
    println!("backend: {d}");
}

/// Saturation humidity ratio, across the range a chart actually spans.
#[test]
fn saturation_humidity_ratio_agrees() {
    let a = atm();
    let mut worst = 0.0_f64;
    for t_c in [0.0_f64, 10.0, 24.0, 35.0, 50.0] {
        let ours = reference::saturation_humidity_ratio(t_c, &a);
        let theirs = backend::saturation_humidity_ratio(t_c, P_STD).expect("W at saturation");
        let rel = (ours - theirs).abs() / theirs;
        println!("t={t_c:>5} Ws ref={ours:.8} frees={theirs:.8} rel={rel:.3e}");
        worst = worst.max(rel);
    }
    assert!(worst < 5e-3, "saturation W separation grew to {worst:.3e}");
}

/// Specific enthalpy, including a sub-freezing state so the ice branch is graded.
#[test]
fn enthalpy_agrees() {
    let mut worst = 0.0_f64;
    for (t_c, rh) in [(24.0, 0.5), (34.0, 0.55), (11.0, 0.95), (-5.0, 0.6)] {
        let w = backend::humidity_ratio_from_rh(t_c, rh, P_STD).expect("W from RH");
        let ours = reference::enthalpy(t_c, w);
        let theirs = backend::enthalpy(t_c, w, P_STD).expect("h");
        println!(
            "t={t_c:>5} rh={rh:.2} h ref={ours:.4} frees={theirs:.4} d={:.4}",
            ours - theirs
        );
        worst = worst.max((ours - theirs).abs());
    }
    assert!(worst < 0.6, "enthalpy separation grew to {worst:.4} kJ/kg");
}

/// Thermodynamic wet-bulb — where independent implementations usually part
/// company, because it is an iterative solve on both sides.
#[test]
fn wet_bulb_agrees() {
    let a = atm();
    let mut worst = 0.0_f64;
    for (t_c, rh) in [(24.0, 0.5), (34.0, 0.55), (30.0, 0.3)] {
        let w = backend::humidity_ratio_from_rh(t_c, rh, P_STD).expect("W from RH");
        let ours = reference::wet_bulb(t_c, w, &a);
        let theirs = backend::wet_bulb(t_c, w, P_STD).expect("t_wb");
        println!(
            "t={t_c:>5} rh={rh:.2} twb ref={ours:.4} frees={theirs:.4} d={:.4}",
            ours - theirs
        );
        worst = worst.max((ours - theirs).abs());
    }
    assert!(worst < 0.25, "wet-bulb separation grew to {worst:.4} K");
}

/// Specific volume, on the dry-air basis in both implementations.
///
/// This is the one most likely to catch a basis error rather than a numerical
/// one: CoolProp's `V` is per kg of dry air and `Vha` is per kg of humid air,
/// and picking the wrong key shifts the answer by about `(1 + W)`.
#[test]
fn specific_volume_agrees_and_is_on_the_dry_air_basis() {
    let a = atm();
    for (t_c, rh) in [(24.0, 0.5), (35.0, 0.6)] {
        let w = backend::humidity_ratio_from_rh(t_c, rh, P_STD).expect("W from RH");
        let ours = reference::specific_volume(t_c, w, &a);
        let theirs = backend::specific_volume(t_c, w, P_STD).expect("v");
        let rel = (ours - theirs).abs() / theirs;
        println!("t={t_c:>5} v ref={ours:.6} frees={theirs:.6} rel={rel:.3e}");
        assert!(
            rel < 5e-3,
            "specific volume separation {rel:.3e} at {t_c} C"
        );
        // A humid-air basis would be about (1 + W) larger — roughly 1%, which is
        // an order of magnitude outside the agreement above.
        assert!(
            rel < 0.5 * w,
            "the separation is the size of a basis error, not a rounding one"
        );
    }
}

/// Dew point, and the frost point below freezing.
#[test]
fn dew_point_agrees_across_the_phase_change() {
    let a = atm();
    for (t_c, rh) in [(24.0, 0.5), (35.0, 0.8), (-5.0, 0.7)] {
        let w = backend::humidity_ratio_from_rh(t_c, rh, P_STD).expect("W from RH");
        let ours = reference::dew_point(w, &a).expect("reference dew point");
        let theirs = backend::dew_point(t_c, w, P_STD).expect("t_dp");
        println!("t={t_c:>5} rh={rh:.2} tdp ref={ours:.4} frees={theirs:.4}");
        assert!(
            (ours - theirs).abs() < 0.25,
            "dew point separation {:.4} K at {t_c} C",
            ours - theirs
        );
        if t_c < 0.0 {
            assert!(theirs < 0.0, "below freezing this is a frost point");
        }
    }
}

/// Relative humidity round-trips through the adapter: asking for a humidity
/// ratio at a given RH and reading the RH back must return what was asked.
///
/// A unit slip in the adapter shows up here immediately, because the trip
/// crosses the kelvin boundary twice.
#[test]
fn relative_humidity_round_trips_through_the_adapter() {
    for (t_c, rh) in [(24.0, 0.5), (-5.0, 0.6), (40.0, 0.25)] {
        let w = backend::humidity_ratio_from_rh(t_c, rh, P_STD).expect("W from RH");
        let back = backend::relative_humidity(t_c, w, P_STD).expect("RH");
        assert!(
            (back - rh).abs() < 1e-9,
            "asked {rh}, got {back} at {t_c} C — check the adapter's units"
        );
    }
}

/// Enthalpy and temperature invert through the adapter, in kJ/kg and °C.
#[test]
fn enthalpy_inverts_through_the_adapter() {
    for (t_c, w) in [(24.0, 0.0093), (-5.0, 0.002), (40.0, 0.020)] {
        let h = backend::enthalpy(t_c, w, P_STD).expect("h");
        let back = backend::temperature_from_enthalpy(h, w, P_STD).expect("t");
        assert!(
            (back - t_c).abs() < 1e-6,
            "asked {t_c} C, got {back} C — a factor of 1000 on h would land here"
        );
        // And the magnitude is kJ/kg, not J/kg: moist air near ambient is tens,
        // not tens of thousands.
        assert!(h.abs() < 500.0, "h = {h} looks like J/kg, not kJ/kg");
    }
}

/// The backend answers a humidity ratio from a dew point *without* reference to
/// the dry bulb — correctly, because `W` does not depend on it. Deciding that
/// the resulting `(t, W)` pair is not moist air is therefore this crate's job,
/// not the backend's, and `StatePoint` is where that check belongs.
#[test]
fn supersaturation_is_caught_here_and_not_by_the_backend() {
    // The backend is happy to answer: W at a 30 C dew point is a real number.
    let w = backend::humidity_ratio_from_dew_point(10.0, 30.0, P_STD)
        .expect("W from a dew point is well defined without the dry bulb");
    assert!(w > 0.0);

    // And it is far above saturation at 10 C, so the state is refused here.
    let err = psychro_core::StatePoint::from_db_dp(10.0, 30.0, &atm())
        .expect_err("30 C dew point at 10 C dry bulb is not moist air");
    assert!(
        err.message().contains("saturation"),
        "unhelpful message: {err}"
    );

    // A dew point at the dry bulb is exactly saturated and must still resolve.
    let s = psychro_core::StatePoint::from_db_dp(10.0, 10.0, &atm())
        .expect("a saturated state is a state");
    assert!((s.rh - 1.0).abs() < 1e-6, "rh = {}", s.rh);
}
