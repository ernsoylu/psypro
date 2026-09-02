//! Worked textbook examples for the elementary processes.
//!
//! The Phase 7 acceptance gate. Each case is a problem an engineer could look up
//! and check by hand, which is the only kind of test that catches a process
//! model that is *self-consistent and wrong* — the failure mode a residual check
//! sails straight past.
//!
//! Tolerances are loose enough for the difference between a book's rounded
//! psychrometric-table lookups and a real-gas backend, and tight enough that a
//! sign error, a missing mass-flow basis, or a swapped effectiveness fails.

use psychro_core::process::{self, protractor, MixResult, SENSIBLE_LIMIT_RH};
use psychro_core::state::{Atmosphere, StatePoint};
use psychro_core::StatePoint as Point;

fn sea_level() -> Atmosphere {
    Atmosphere::sea_level()
}

fn at(t: f64, rh: f64) -> Point {
    StatePoint::from_db_rh(t, rh, &sea_level()).expect("a state")
}

// ── Sensible processes ──────────────────────────────────────────────────────

/// Reheat: 2 kg/s of dry air raised 10 K. The load is entirely sensible, and
/// the humidity ratio does not move at all.
#[test]
fn sensible_heating_is_horizontal_and_entirely_sensible() {
    let atm = sea_level();
    let inlet = at(13.0, 0.90);
    let r = process::sensible_to(&inlet, 23.0, 2.0, &atm).expect("heating");

    assert!(
        (r.outlet.w - inlet.w).abs() < 1e-12,
        "reheat moved moisture: {} -> {}",
        inlet.w,
        r.outlet.w
    );
    assert!((r.load.moisture).abs() < 1e-12);
    assert!(r.load.latent.abs() < 1e-9);
    // q = m_da * cp_ma * dt, with cp_ma = 1.006 + W*1.84 at W ~ 0.0084.
    let expected = 2.0 * (1.006 + inlet.w * 1.84) * 10.0;
    assert!(
        (r.load.total - expected).abs() < 0.2,
        "q = {:.3} kW, expected about {expected:.3}",
        r.load.total
    );
    assert_eq!(r.load.shr.map(|s| (s - 1.0).abs() < 1e-9), Some(true));
}

/// The data-centre case. SHR = 1.0 is a *design*, not a degeneracy, and the
/// protractor has to say so rather than divide by zero.
#[test]
fn a_fully_sensible_process_reports_shr_one_and_an_infinite_slope() {
    let atm = sea_level();
    let inlet = at(24.0, 0.40);
    let r = process::sensible_to(&inlet, 35.0, 5.0, &atm).expect("server heat");

    assert_eq!(r.load.shr.map(|s| (s - 1.0).abs() < 1e-9), Some(true));
    // Vertical on the protractor: the process moves no moisture, so there is no
    // finite enthalpy-per-moisture slope to report.
    assert_eq!(protractor::slope_from_shr(1.0), None);
    assert!(r.load.total > 0.0);
}

/// Sensible cooling stops being sensible near saturation. §4.1 puts the
/// practical limit at about 85% RH, and the engine flags it rather than
/// extrapolating a horizontal line into the saturation curve.
#[test]
fn sensible_cooling_flags_the_practical_limit() {
    let atm = sea_level();
    let inlet = at(30.0, 0.50);

    let comfortable = process::sensible_to(&inlet, 24.0, 1.0, &atm).expect("cooling");
    assert!(!comfortable.near_saturation);

    // Cool the same air to within a degree of its dew point and it is no longer
    // a sensible-only process, whatever the model says.
    let close = process::sensible_to(&inlet, inlet.t_dp + 1.0, 1.0, &atm).expect("cooling");
    assert!(close.outlet.rh >= SENSIBLE_LIMIT_RH);
    assert!(close.near_saturation, "rh = {:.3}", close.outlet.rh);
}

/// A duty in kilowatts and a target temperature must describe the same process.
#[test]
fn a_duty_and_a_target_temperature_agree() {
    let atm = sea_level();
    let inlet = at(13.0, 0.90);
    let by_temperature = process::sensible_to(&inlet, 23.0, 2.0, &atm).expect("to 23 C");
    let by_duty =
        process::sensible_duty(&inlet, by_temperature.load.total, 2.0, &atm).expect("by duty");

    assert!(
        (by_duty.outlet.t_db - 23.0).abs() < 1e-6,
        "landed at {:.6} C",
        by_duty.outlet.t_db
    );
}

// ── Mixing ──────────────────────────────────────────────────────────────────

/// ASHRAE Fundamentals Ch. 1, the standard mixing example: 2 kg/s of outdoor air
/// at 35 °C / 0.0182 mixed with 3 kg/s of return air at 24 °C / 0.0093.
///
/// The mix point lies on the line between the two states, at the fraction the
/// dry-air flows set — 60% of the way toward the return air.
#[test]
fn adiabatic_mixing_lands_on_the_line_at_the_flow_fraction() {
    let atm = sea_level();
    let oa = StatePoint::from_db_w(35.0, 0.0182, &atm).expect("outdoor air");
    let ra = StatePoint::from_db_w(24.0, 0.0093, &atm).expect("return air");

    let MixResult::Mixed { outlet, mdot_da } = process::mix(&oa, 2.0, &ra, 3.0, &atm) else {
        panic!("an ordinary mix");
    };

    assert!((mdot_da - 5.0).abs() < 1e-12);
    // Flow-weighted on the DRY-AIR basis: 0.4 of the outdoor stream.
    let expected_w = 0.4 * 0.0182 + 0.6 * 0.0093;
    let expected_h = 0.4 * oa.h + 0.6 * ra.h;
    assert!((outlet.w - expected_w).abs() < 1e-9, "W = {}", outlet.w);
    assert!((outlet.h - expected_h).abs() < 1e-6, "h = {}", outlet.h);
    // The volumetric approximation for t_mix is within 1%, which is why it is
    // offered only as a labelled approximation and never as a result.
    let approx_t = 0.4 * 35.0 + 0.6 * 24.0;
    assert!((outlet.t_db - approx_t).abs() < 0.4 * approx_t.abs() / 100.0 + 0.1);
}

/// "Winter V" mixing: cold dry outdoor air mixed with warm humid return air can
/// cross the saturation curve, because that curve is convex and the mix line is
/// a chord. The mixture fogs and water drops out.
///
/// A tool that reports an error here is refusing to model something that happens
/// in every cold-climate mixing box.
#[test]
fn winter_v_mixing_fogs_and_drops_water_out() {
    let atm = sea_level();
    let oa = at(-15.0, 0.60);
    let ra = StatePoint::from_db_w(24.0, 0.0140, &atm).expect("humid return air");

    let result = process::mix(&oa, 1.0, &ra, 1.0, &atm);
    let MixResult::WinterV {
        outlet,
        condensate,
        mdot_da,
    } = result
    else {
        panic!("expected the mix line to cross saturation, got {result:?}");
    };

    assert!((mdot_da - 2.0).abs() < 1e-12);
    assert!(
        (outlet.rh - 1.0).abs() < 1e-6,
        "the mixture settles saturated"
    );
    assert!(condensate > 0.0, "water must come out, got {condensate}");

    // Enthalpy is what survives the phase change, so the fogged mixture sits at
    // the enthalpy the chord had.
    let chord_h = 0.5 * (oa.h + ra.h);
    assert!(
        (outlet.h - chord_h).abs() < 0.2,
        "h = {:.3}, chord = {chord_h:.3}",
        outlet.h
    );
    // ...and below the chord's humidity ratio, by exactly what condensed.
    let chord_w = 0.5 * (oa.w + ra.w);
    assert!((condensate - (chord_w - outlet.w) * 2.0).abs() < 1e-12);
}

/// Mixing conserves dry air, water and energy, whatever the split.
#[test]
fn mixing_conserves_everything_it_should() {
    let atm = sea_level();
    let a = at(32.0, 0.55);
    let b = at(20.0, 0.35);

    for (ma, mb) in [(1.0, 1.0), (0.25, 3.0), (4.0, 0.5)] {
        let MixResult::Mixed { outlet, mdot_da } = process::mix(&a, ma, &b, mb, &atm) else {
            panic!("an ordinary mix");
        };
        assert!((mdot_da - (ma + mb)).abs() < 1e-12);
        assert!((mdot_da * outlet.w - (ma * a.w + mb * b.w)).abs() < 1e-12);
        assert!((mdot_da * outlet.h - (ma * a.h + mb * b.h)).abs() < 1e-9);
    }
}

// ── Humidification ──────────────────────────────────────────────────────────

/// Steam humidification is near-isothermal: the latent heat was supplied in the
/// boiler, so injecting saturated steam is closer to mixing two gases than to
/// heating air.
#[test]
fn steam_humidification_barely_moves_the_dry_bulb() {
    let atm = sea_level();
    let inlet = StatePoint::from_db_w(20.0, 0.0040, &atm).expect("dry winter air");
    // Dry saturated steam at 100 C: h_g = 2676 kJ/kg.
    let r = process::steam_humidify(&inlet, 0.0080, 2676.0, 1.5, &atm).expect("steam");

    assert!((r.process.outlet.w - 0.0080).abs() < 1e-12);
    // Under a degree of dry-bulb rise for a doubling of the humidity ratio.
    assert!(
        (r.process.outlet.t_db - 20.0).abs() < 1.0,
        "dry bulb moved to {:.3} C",
        r.process.outlet.t_db
    );
    // m_steam = m_da * (W_out - W_in), on the dry-air basis.
    assert!((r.steam_flow - 1.5 * 0.0040).abs() < 1e-12);
    // Almost all latent, which is what makes the line near-vertical.
    let shr = r.process.load.shr.expect("a load");
    assert!(shr.abs() < 0.1, "shr = {shr:.4}");
}

/// Evaporative cooling follows a constant wet-bulb line and cannot pass it.
/// Saturation effectiveness is the fraction of the wet-bulb depression the
/// device delivers: 300 mm rigid media reaches about 0.88.
#[test]
fn evaporative_cooling_holds_wet_bulb_and_respects_effectiveness() {
    let atm = sea_level();
    let inlet = at(35.0, 0.20);
    let depression = inlet.t_db - inlet.t_wb;
    let r = process::evaporative(&inlet, 0.88, 1.0, &atm).expect("evaporative");

    assert!(
        (r.outlet.t_wb - inlet.t_wb).abs() < 1e-6,
        "wet bulb moved: {} -> {}",
        inlet.t_wb,
        r.outlet.t_wb
    );
    let delivered = (inlet.t_db - r.outlet.t_db) / depression;
    assert!((delivered - 0.88).abs() < 1e-6, "delivered {delivered:.4}");
    // Cooler and wetter — up and to the left.
    assert!(r.outlet.t_db < inlet.t_db);
    assert!(r.outlet.w > inlet.w);
    // Adiabatic, but not isenthalpic: the water brings its own enthalpy in.
    assert!(r.load.total.abs() < 0.5, "q = {:.4} kW", r.load.total);
}

/// A perfect evaporative cooler reaches saturation at the entering wet bulb,
/// and cannot go past it.
#[test]
fn a_perfect_evaporative_cooler_reaches_the_entering_wet_bulb() {
    let atm = sea_level();
    let inlet = at(35.0, 0.20);
    let r = process::evaporative(&inlet, 1.0, 1.0, &atm).expect("evaporative");
    assert!((r.outlet.t_db - inlet.t_wb).abs() < 1e-6);
    assert!((r.outlet.rh - 1.0).abs() < 1e-6, "rh = {}", r.outlet.rh);
}

// ── Energy recovery ─────────────────────────────────────────────────────────

/// ASHRAE Standard 84: sensible effectiveness is measured on temperature and
/// latent on humidity ratio, as two independent ratings.
#[test]
fn energy_recovery_applies_each_effectiveness_to_its_own_quantity() {
    let atm = sea_level();
    let outdoor = StatePoint::from_db_w(-10.0, 0.0012, &atm).expect("winter outdoor air");
    let exhaust = StatePoint::from_db_w(22.0, 0.0085, &atm).expect("exhaust air");

    let r = process::energy_recovery(&outdoor, &exhaust, 0.75, 0.60, 1.0, &atm).expect("erv");

    let expected_t = -10.0 + 0.75 * (22.0 - -10.0);
    let expected_w = 0.0012 + 0.60 * (0.0085 - 0.0012);
    assert!(
        (r.outlet.t_db - expected_t).abs() < 1e-6,
        "t = {}",
        r.outlet.t_db
    );
    assert!(
        (r.outlet.w - expected_w).abs() < 1e-12,
        "w = {}",
        r.outlet.w
    );
    // Both legs contribute; a single enthalpy effectiveness could not produce
    // this pair, which is why Standard 84 rates them separately.
    assert!(r.load.sensible > 0.0 && r.load.latent > 0.0);
}

/// The sensible-only family — fixed plate, heat wheel, heat pipe, run-around
/// loop, thermosiphon — moves no moisture at all.
#[test]
fn a_sensible_only_exchanger_moves_no_moisture() {
    let atm = sea_level();
    let outdoor = StatePoint::from_db_w(-10.0, 0.0012, &atm).expect("outdoor");
    let exhaust = StatePoint::from_db_w(22.0, 0.0085, &atm).expect("exhaust");

    let r = process::energy_recovery(&outdoor, &exhaust, 0.70, 0.0, 1.0, &atm).expect("hrv");
    assert!((r.outlet.w - outdoor.w).abs() < 1e-12);
    assert!(r.load.latent.abs() < 1e-9);
    assert_eq!(r.load.shr.map(|s| (s - 1.0).abs() < 1e-9), Some(true));
}

// ── The protractor ──────────────────────────────────────────────────────────

/// The two protractor scales are the same scale, and this is the relation
/// `REQUIREMENTS.md` §4.9 specifies: `Δh/ΔW = 2499.86/(1 − SHR)`.
#[test]
fn the_protractor_scales_invert_each_other() {
    for shr in [0.0, 0.25, 0.5, 0.7, 0.85, 0.95, 1.5, -0.5] {
        let slope = protractor::slope_from_shr(shr).expect("a finite slope");
        let back = protractor::shr_from_slope(slope).expect("a ratio");
        assert!((back - shr).abs() < 1e-9, "{shr} -> {slope} -> {back}");
    }
    // SHR = 1 has no finite slope, and that is the data-centre case.
    assert_eq!(protractor::slope_from_shr(1.0), None);
    // A zero slope is all-latent: the dehumidification-only vector.
    assert_eq!(protractor::shr_from_slope(0.0), Some(0.0));
}

/// The load decomposition and the protractor must agree on the same process, or
/// the line drawn on the chart disagrees with the numbers in the panel.
///
/// This holds *exactly* rather than approximately, because the latent split uses
/// the same `h_g,ref` the chart's reduced coordinate is defined against.
#[test]
fn the_protractor_matches_the_load_it_describes() {
    let atm = sea_level();
    let inlet = at(27.0, 0.50);

    for target in [(15.0, 0.008), (20.0, 0.012), (30.0, 0.006)] {
        let outlet = StatePoint::from_db_w(target.0, target.1, &atm).expect("a state");
        let l = process::load(&inlet, &outlet, 2.0);
        let shr = l.shr.expect("a load");

        let measured_slope = (outlet.h - inlet.h) / (outlet.w - inlet.w);
        let from_shr = protractor::slope_from_shr(shr).expect("a finite slope");
        assert!(
            (measured_slope - from_shr).abs() < 1e-6 * measured_slope.abs().max(1.0),
            "slope {measured_slope:.4} vs protractor {from_shr:.4} at SHR {shr:.4}"
        );
    }
}

// ── The general linear process ──────────────────────────────────────────────

/// A point part-way along a process lies on the straight line the chart draws,
/// because the interpolation is on the `(W, h)` pair the chart's axes are built
/// from — not on `(W, t)`, which is a different curve.
#[test]
fn a_linear_process_interpolates_on_the_pair_the_chart_is_built_from() {
    let atm = sea_level();
    let a = at(30.0, 0.60);
    let b = at(14.0, 0.90);

    let mid = process::along(&a, &b, 0.5, &atm).expect("midpoint");
    assert!((mid.w - 0.5 * (a.w + b.w)).abs() < 1e-12);
    assert!((mid.h - 0.5 * (a.h + b.h)).abs() < 1e-9);
    // A (W, t) interpolation would land somewhere else, and that is the curve a
    // renderer draws if it interpolates endpoints in screen space.
    assert!((mid.t_db - 0.5 * (a.t_db + b.t_db)).abs() > 1e-6);

    // The endpoints are the endpoints.
    assert!((process::along(&a, &b, 0.0, &atm).expect("start").h - a.h).abs() < 1e-9);
    assert!((process::along(&a, &b, 1.0, &atm).expect("end").h - b.h).abs() < 1e-9);
}
