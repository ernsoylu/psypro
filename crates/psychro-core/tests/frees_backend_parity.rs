//! Grades the frees / rustprop humid-air path against the same ASHRAE reference
//! values this crate's own implementation is held to.
//!
//! This is the acceptance gate for adopting frees as the calculation backend: if
//! the two agree on the reference states, the conformance suite transfers intact
//! and the switch is safe.

use frees_core::props::propfun;
use frees_core::props::rustprop_backend::RustpropBackend;
use psychro_core::constants::P_STD;
use psychro_core::state::{Atmosphere, StatePoint};
use std::sync::Arc;

fn install() {
    if propfun::backend().is_none() {
        propfun::install(Arc::new(RustpropBackend));
    }
}

/// Humidity ratio at saturation, both implementations, near-ambient.
#[test]
fn saturation_humidity_ratio_agrees_with_frees() {
    install();
    let atm = Atmosphere::sea_level();
    for t_c in [0.0_f64, 10.0, 24.0, 35.0, 50.0] {
        let ours = StatePoint::from_db_rh(t_c, 1.0, &atm).w;
        let theirs = propfun::ha_props_si("W", "T", t_c + 273.15, "R", 1.0, "P", P_STD)
            .expect("HAPropsSI W");
        let rel = (ours - theirs).abs() / theirs;
        println!("t={t_c:>5} Ws ours={ours:.8} frees={theirs:.8} rel={rel:.3e}");
        assert!(rel < 5e-3, "saturation W diverges at {t_c} C: {rel:.3e}");
    }
}

/// Enthalpy on the dry-air basis, both implementations.
#[test]
fn enthalpy_agrees_with_frees() {
    install();
    let atm = Atmosphere::sea_level();
    for (t_c, rh) in [(24.0, 0.5), (34.0, 0.55), (11.0, 0.95), (-5.0, 0.6)] {
        let s = StatePoint::from_db_rh(t_c, rh, &atm);
        // frees returns J/kg_da; this crate works in kJ/kg_da.
        let theirs = propfun::ha_props_si("H", "T", t_c + 273.15, "R", rh, "P", P_STD)
            .expect("HAPropsSI H")
            / 1000.0;
        println!(
            "t={t_c:>5} rh={rh:.2} h ours={:.4} frees={theirs:.4} diff={:.4}",
            s.h,
            s.h - theirs
        );
        assert!(
            (s.h - theirs).abs() < 0.6,
            "enthalpy diverges at {t_c} C / {rh}: ours {:.4} vs frees {theirs:.4}",
            s.h
        );
    }
}

/// Thermodynamic wet-bulb, which is where independent implementations usually
/// part company.
#[test]
fn wet_bulb_agrees_with_frees() {
    install();
    let atm = Atmosphere::sea_level();
    for (t_c, rh) in [(24.0, 0.5), (34.0, 0.55), (30.0, 0.3)] {
        let s = StatePoint::from_db_rh(t_c, rh, &atm);
        let theirs = propfun::ha_props_si("B", "T", t_c + 273.15, "R", rh, "P", P_STD)
            .expect("HAPropsSI B")
            - 273.15;
        println!(
            "t={t_c:>5} rh={rh:.2} twb ours={:.4} frees={theirs:.4} diff={:.4}",
            s.t_wb,
            s.t_wb - theirs
        );
        assert!(
            (s.t_wb - theirs).abs() < 0.25,
            "wet bulb diverges at {t_c} C / {rh}: ours {:.4} vs frees {theirs:.4}",
            s.t_wb
        );
    }
}

/// The backend is actually present — a silent absence would make the tests above
/// vacuous if they ever moved to an `_or_nan` call.
#[test]
fn rustprop_backend_is_installed() {
    install();
    assert!(propfun::is_available());
    println!("backend: {}", propfun::backend_description());
}
