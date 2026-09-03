//! The wet coil, the desiccant, and the identification of a process from its
//! two endpoints.
//!
//! The case that motivates this file: `sensible_to` is asked to cool air below
//! its own dew point. Holding `W` there asks for a state above the saturation
//! curve, so the old answer was a supersaturation error — which is not what a
//! coil does. `cool_to` condenses instead, and these tests pin *what* it
//! condenses rather than merely that it stopped failing.

use psychro_core::identify::{self, Fit};
use psychro_core::process;
use psychro_core::state::{Atmosphere, StatePoint};
use psychro_core::StatePoint as Point;

fn sea_level() -> Atmosphere {
    Atmosphere::sea_level()
}

fn at(t: f64, rh: f64) -> Point {
    StatePoint::from_db_rh(t, rh, &sea_level()).expect("a state")
}

// ── The reported bug ────────────────────────────────────────────────────────

/// 26 °C / 50% air has a dew point near 14.8 °C. Asking a *sensible* process to
/// take it to 12 °C is asking for the impossible, and it says so.
#[test]
fn holding_moisture_below_the_dew_point_is_still_refused() {
    let atm = sea_level();
    let inlet = at(26.0, 0.50);
    assert!(
        inlet.t_dp > 12.0,
        "the case needs a dew point above the target: t_dp = {:.2}",
        inlet.t_dp
    );
    assert!(
        process::sensible_to(&inlet, 12.0, 1.0, &atm).is_err(),
        "a horizontal line into the saturation curve is not a state"
    );
}

/// The same request, put to the coil. It condenses rather than failing, and the
/// water it takes out is the water the mass balance says it took out.
#[test]
fn the_same_target_given_to_a_coil_makes_condensate() {
    let atm = sea_level();
    let inlet = at(26.0, 0.50);
    let mdot = 1.5;
    let r = process::cool_to(&inlet, 12.0, process::DEFAULT_BYPASS_FACTOR, mdot, &atm)
        .expect("a wet coil");

    assert!(r.dehumidified(), "a coil below the dew point runs wet");
    assert!(
        (r.process.outlet.t_db - 12.0).abs() < 1e-9,
        "the leaving temperature is the one that was asked for: {:.4}",
        r.process.outlet.t_db
    );
    assert!(
        r.process.outlet.w < inlet.w,
        "the air left drier: {:.6} against {:.6}",
        r.process.outlet.w,
        inlet.w
    );
    // ṁ_cond = ṁ_da·(W_ent − W_lvg). The same balance, stated independently of
    // the construction that produced the leaving state.
    let expected = mdot * (inlet.w - r.process.outlet.w);
    assert!(
        (r.condensate - expected).abs() < 1e-12,
        "condensate {:.8} against the balance's {expected:.8}",
        r.condensate
    );
    assert!(!r.frost_risk, "a 9 °C surface does not frost");

    let coil = r.coil.expect("a wet coil reports its construction");
    // The bypass factor that was asked for is read back **exactly** on humidity
    // ratio and on enthalpy, because those two are the coil's own balances: the
    // contacted and bypassed streams mix on mass and on energy, and the leaving
    // state is that mixture.
    let bf = process::DEFAULT_BYPASS_FACTOR;
    assert!(
        (coil.bf_humidity_ratio - bf).abs() < 1e-7 && (coil.bf_enthalpy - bf).abs() < 1e-7,
        "BF on the balances came back as W {:.9}, h {:.9}",
        coil.bf_humidity_ratio,
        coil.bf_enthalpy
    );
    // The temperature form is the approximate one, and it is off by the
    // c_pv·Δ(W·t) cross term enthalpy carries and temperature does not. Under a
    // percent, which is the disagreement coil.rs already documents between its
    // three forms — and the reason all three are reported rather than one.
    assert!(
        (coil.bf_temperature - bf).abs() < 5e-3,
        "BF on temperature came back as {:.6}",
        coil.bf_temperature
    );
}

/// A coil with no bypass leaves the air saturated at the target — and that makes
/// it the coil that removes the **least** water, not the most.
///
/// The intuition runs the other way and it is worth pinning, because it is the
/// reason zero is not the default. At a fixed *apparatus dew point*, less bypass
/// does mean more dehumidification. At a fixed *leaving temperature*, which is
/// how a user states a coil, less bypass means a warmer surface — and a warmer
/// surface condenses less. Zero bypass therefore leaves the air as wet as it can
/// be at that temperature: saturated, which no coil delivers.
#[test]
fn no_bypass_leaves_saturated_air_and_the_least_condensate() {
    let atm = sea_level();
    let inlet = at(26.0, 0.50);
    let ideal = process::cool_to(&inlet, 12.0, 0.0, 1.0, &atm).expect("an ideal coil");

    assert!(ideal.dehumidified());
    assert!(
        ideal.process.outlet.rh > 0.999,
        "with no bypass the whole stream sees the surface: RH = {:.4}",
        ideal.process.outlet.rh
    );

    let real = process::cool_to(&inlet, 12.0, 0.15, 1.0, &atm).expect("a real coil");
    assert!(
        real.condensate > ideal.condensate,
        "15% bypass {:.6} should beat no bypass {:.6} at the same leaving temperature",
        real.condensate,
        ideal.condensate
    );
    assert!(
        real.process.outlet.rh < 0.96,
        "and its leaving air is where coils actually run: RH = {:.4}",
        real.process.outlet.rh
    );
    // Both left at the temperature that was asked for; only the moisture moved.
    for r in [&ideal, &real] {
        assert!((r.process.outlet.t_db - 12.0).abs() < 1e-6);
    }
}

/// Above the dew point the coil is dry, the process is horizontal, and the
/// bypass factor has nothing to act on.
#[test]
fn a_target_above_the_dew_point_is_the_dry_horizontal_process() {
    let atm = sea_level();
    let inlet = at(26.0, 0.50);
    let r = process::cool_to(&inlet, 20.0, process::DEFAULT_BYPASS_FACTOR, 2.0, &atm)
        .expect("a dry coil");

    assert!(!r.dehumidified(), "nothing condenses above the dew point");
    assert_eq!(r.condensate, 0.0);
    assert!((r.process.outlet.w - inlet.w).abs() < 1e-12);
    assert!(r.process.load.latent.abs() < 1e-9);

    // Identical to what the sensible process gives, which is the point: the
    // wet branch is an extension, not a replacement.
    let sensible = process::sensible_to(&inlet, 20.0, 2.0, &atm).expect("heating");
    assert!((r.process.load.total - sensible.load.total).abs() < 1e-12);
}

/// Heating is the same call with the target the other way, so a UI does not
/// have to know which it is before it asks.
#[test]
fn cooling_to_a_warmer_target_is_ordinary_heating() {
    let atm = sea_level();
    let inlet = at(13.0, 0.90);
    let r =
        process::cool_to(&inlet, 23.0, process::DEFAULT_BYPASS_FACTOR, 2.0, &atm).expect("reheat");

    assert!(!r.dehumidified());
    assert!(r.process.load.total > 0.0);
    assert!((r.process.outlet.w - inlet.w).abs() < 1e-12);
}

/// The dry and wet branches meet, which is the reason the branch is decided on
/// the *surface* rather than on the target temperature.
///
/// Sweeping the target down through the dew point must not step the condensate:
/// a coil that starts draining water discontinuously is a coil whose model has a
/// seam in it.
#[test]
fn the_condensate_is_continuous_across_the_dry_wet_boundary() {
    let atm = sea_level();
    let inlet = at(26.0, 0.50);
    let bf = process::DEFAULT_BYPASS_FACTOR;
    // The surface reaches the entering dew point at this target, which is where
    // the branch changes: t_adp = t_dp ⇔ t_lvg = t_dp + BF·(t_ent − t_dp).
    let boundary = inlet.t_dp + bf * (inlet.t_db - inlet.t_dp);

    let dry = process::cool_to(&inlet, boundary + 1e-6, bf, 1.0, &atm).expect("dry side");
    let wet = process::cool_to(&inlet, boundary - 1e-6, bf, 1.0, &atm).expect("wet side");

    assert!(
        !dry.dehumidified() && wet.dehumidified(),
        "the branch changed"
    );
    // A tenth of a milligram per second. What is left is the backend's own
    // dew-point round trip — W → t_dp → W_s(t_dp) closes to about 1.6e-4 K —
    // and not a seam in the model. Taking the branch on the target temperature
    // instead of on the surface steps by 7e-4 kg/s here, three orders of
    // magnitude larger, so this tolerance still catches that mistake.
    assert!(
        (dry.condensate - wet.condensate).abs() < 1e-6,
        "the condensate stepped at the boundary: {:.10} to {:.10}",
        dry.condensate,
        wet.condensate
    );
    assert!(
        (dry.process.outlet.w - wet.process.outlet.w).abs() < 1e-6,
        "the leaving humidity stepped at the boundary"
    );
}

/// A surface below freezing is reported, not refused: it is what a starved DX
/// coil does, and §4.2's anti-ice limit is a warning a designer acts on.
#[test]
fn a_sub_freezing_surface_is_flagged_rather_than_refused() {
    let atm = sea_level();
    let inlet = at(24.0, 0.55);
    let r = process::cool_to(&inlet, 1.0, 0.10, 1.0, &atm).expect("a frosting coil");
    assert!(r.dehumidified());
    assert!(
        r.frost_risk,
        "an ADP near {:.2} °C should raise the anti-ice flag",
        r.coil.expect("a coil").adp.t_db
    );
}

/// A bypass factor of 1 is a coil the air never touches, and 1.4 is not a
/// fraction at all. Both are refused with a message rather than dividing by
/// zero.
#[test]
fn an_impossible_bypass_factor_is_refused() {
    let atm = sea_level();
    let inlet = at(26.0, 0.50);
    for bf in [1.0, 1.4, -0.1] {
        assert!(
            process::cool_to(&inlet, 12.0, bf, 1.0, &atm).is_err(),
            "a bypass factor of {bf} should be refused"
        );
    }
}

/// A duty is the same coil stated the other way round, so the two forms have to
/// land in the same place.
///
/// Solve for the leaving temperature at a given duty, hand that temperature back
/// as a target, and the same state must come out. Nothing else asserts that the
/// closed-form enthalpy inversion and the secant on temperature agree.
#[test]
fn a_duty_and_a_target_temperature_describe_the_same_wet_coil() {
    let atm = sea_level();
    let inlet = at(26.0, 0.50);
    let bf = process::DEFAULT_BYPASS_FACTOR;
    let mdot = 1.5;

    let by_duty = process::cool_by_duty(&inlet, -30.0, bf, mdot, &atm).expect("a rated coil");
    assert!(
        by_duty.dehumidified(),
        "30 kW off 1.5 kg/s runs the coil wet"
    );
    assert!(
        (by_duty.process.load.total + 30.0).abs() < 1e-9,
        "the duty asked for is the duty delivered: {:.6}",
        by_duty.process.load.total
    );

    let by_target = process::cool_to(&inlet, by_duty.process.outlet.t_db, bf, mdot, &atm)
        .expect("the same coil");
    assert!(
        (by_target.process.outlet.w - by_duty.process.outlet.w).abs() < 1e-7,
        "the two forms disagree on moisture: {:.9} against {:.9}",
        by_target.process.outlet.w,
        by_duty.process.outlet.w
    );
    assert!(
        (by_target.condensate - by_duty.condensate).abs() < 1e-7,
        "the two forms disagree on condensate: {:.9} against {:.9}",
        by_target.condensate,
        by_duty.condensate
    );
}

/// A duty too small to reach the dew point is the dry process, and agrees with
/// the sensible entry point that has always handled it.
#[test]
fn a_small_duty_stays_dry_and_matches_the_sensible_form() {
    let atm = sea_level();
    let inlet = at(26.0, 0.50);
    let mdot = 2.0;
    let r = process::cool_by_duty(&inlet, -10.0, process::DEFAULT_BYPASS_FACTOR, mdot, &atm)
        .expect("a dry coil");
    let sensible = process::sensible_duty(&inlet, -10.0, mdot, &atm).expect("sensible");

    assert!(!r.dehumidified());
    assert!((r.process.outlet.t_db - sensible.outlet.t_db).abs() < 1e-9);
    assert!((r.process.outlet.w - inlet.w).abs() < 1e-12);
}

// ── The desiccant direction ─────────────────────────────────────────────────

/// The mirror image of evaporative cooling: the air leaves warmer and drier,
/// along a line of constant enthalpy.
#[test]
fn a_desiccant_leaves_the_air_warmer_and_drier() {
    let atm = sea_level();
    let inlet = at(30.0, 0.60);
    let r = process::desiccant(&inlet, 0.002, 0.7, 1.0, &atm).expect("a wheel");

    assert!(
        r.outlet.w < inlet.w,
        "a desiccant dries: {:.6} to {:.6}",
        inlet.w,
        r.outlet.w
    );
    assert!(
        r.outlet.t_db > inlet.t_db,
        "and warms, because the sorption heat has to go somewhere: {:.2} to {:.2}",
        inlet.t_db,
        r.outlet.t_db
    );
    assert!(
        (r.outlet.h - inlet.h).abs() < 1e-6,
        "the ideal path is isenthalpic: {:.4} to {:.4}",
        inlet.h,
        r.outlet.h
    );
    // ε_L = (W_in − W_out)/(W_in − W_eq), read back off the result.
    let eps = (inlet.w - r.outlet.w) / (inlet.w - 0.002);
    assert!(
        (eps - 0.7).abs() < 1e-9,
        "effectiveness came back as {eps:.6}"
    );
    // The load is all latent-for-sensible trade at constant enthalpy, so the
    // total is zero and there is no ratio to report.
    assert!(r.load.total.abs() < 1e-6);
    assert!(r.load.shr.is_none() || r.load.shr.expect("a ratio").abs() > 1.0);
}

// ── Identification ──────────────────────────────────────────────────────────

/// Build a process forward with known parameters, identify it backwards, and
/// assert the parameters come back. This is the test that makes "some of the
/// process data is calculated automatically" a claim rather than a hope.
#[test]
fn a_process_built_forward_is_identified_backward() {
    let atm = sea_level();
    let mdot = 1.25;

    // Sensible heating.
    let inlet = at(13.0, 0.90);
    let heated = process::sensible_to(&inlet, 23.0, mdot, &atm).expect("heating");
    let fit = identify::identify(&inlet, &heated.outlet, mdot, &atm);
    match fit.fit {
        Fit::SensibleHeating { duty } => assert!(
            (duty - heated.load.total).abs() < 1e-9,
            "duty {duty:.4} against the load's {:.4}",
            heated.load.total
        ),
        other => panic!("identified sensible heating as {other:?}"),
    }
    assert!(fit.slope.is_none(), "no moisture moved, so no finite slope");

    // Evaporative humidification at a known effectiveness.
    let warm = at(35.0, 0.20);
    let cooled = process::evaporative(&warm, 0.88, mdot, &atm).expect("a cooler");
    let fit = identify::identify(&warm, &cooled.outlet, mdot, &atm);
    match fit.fit {
        Fit::Evaporative { effectiveness, .. } => assert!(
            (effectiveness - 0.88).abs() < 1e-6,
            "effectiveness came back as {effectiveness:.6}"
        ),
        other => panic!("identified evaporative cooling as {other:?}"),
    }

    // Steam injection at a known steam enthalpy.
    let dry = at(20.0, 0.30);
    let steamed =
        process::steam_humidify(&dry, dry.w + 0.003, 2676.0, mdot, &atm).expect("an injection");
    let fit = identify::identify(&dry, &steamed.process.outlet, mdot, &atm);
    match fit.fit {
        Fit::Isothermal {
            steam_flow,
            steam_enthalpy,
        } => {
            assert!(
                (steam_enthalpy - 2676.0).abs() < 1.0,
                "steam enthalpy came back as {steam_enthalpy:.2}"
            );
            assert!((steam_flow - mdot * 0.003).abs() < 1e-9);
        }
        other => panic!("identified steam humidification as {other:?}"),
    }

    // A wet coil, identified as one, with its construction attached.
    let humid = at(26.0, 0.50);
    let coiled = process::cool_to(&humid, 12.0, 0.1, mdot, &atm).expect("a coil");
    let fit = identify::identify(&humid, &coiled.process.outlet, mdot, &atm);
    match fit.fit {
        Fit::CoolingDehumidification { coil } => {
            // On the balances, which are the exact forms; the temperature form
            // is approximate by the cross term, as above.
            assert!(
                (coil.bf_humidity_ratio - 0.1).abs() < 1e-6,
                "BF came back as {:.6}",
                coil.bf_humidity_ratio
            );
            assert!(coil.condensate > 0.0);
        }
        other => panic!("identified a wet coil as {other:?}"),
    }

    // And a desiccant, which is the same test in the other direction.
    let muggy = at(30.0, 0.60);
    let dried = process::desiccant(&muggy, 0.002, 0.7, mdot, &atm).expect("a wheel");
    let fit = identify::identify(&muggy, &dried.outlet, mdot, &atm);
    match fit.fit {
        Fit::Desiccant {
            water_removed,
            enthalpy_rise,
        } => {
            assert!((water_removed - mdot * (muggy.w - dried.outlet.w)).abs() < 1e-12);
            assert!(
                enthalpy_rise.abs() < 1e-6,
                "the ideal path is isenthalpic, so the rise is {enthalpy_rise:.6}"
            );
        }
        other => panic!("identified a desiccant as {other:?}"),
    }
}

/// A chord that is no named process says so, rather than being forced into the
/// nearest category.
#[test]
fn an_arbitrary_chord_is_general_and_still_reports_its_load() {
    let atm = sea_level();
    // Warmer *and* wetter: heating with humidification, which §4.1 lists as a
    // direction but not as an elementary vector with parameters of its own.
    let from = at(15.0, 0.40);
    let to = at(30.0, 0.60);
    let fit = identify::identify(&from, &to, 1.0, &atm);
    assert!(matches!(fit.fit, Fit::General), "got {:?}", fit.fit);
    assert!(fit.load.total > 0.0);
    assert!(
        fit.slope.is_some(),
        "moisture moved, so the slope is finite"
    );
}

/// Identification is a question about the two states, so the flow scales what
/// it reports and never what it decides.
#[test]
fn the_flow_scales_the_report_but_not_the_classification() {
    let atm = sea_level();
    let from = at(35.0, 0.20);
    let to = process::evaporative(&from, 0.88, 1.0, &atm)
        .expect("a cooler")
        .outlet;

    let one = identify::identify(&from, &to, 1.0, &atm);
    let ten = identify::identify(&from, &to, 10.0, &atm);

    match (one.fit, ten.fit) {
        (
            Fit::Evaporative {
                effectiveness: a,
                water_flow: wa,
            },
            Fit::Evaporative {
                effectiveness: b,
                water_flow: wb,
            },
        ) => {
            assert!((a - b).abs() < 1e-12, "effectiveness is not a flow");
            assert!((wb - 10.0 * wa).abs() < 1e-12, "water flow scales");
        }
        other => panic!("classification moved with the flow: {other:?}"),
    }
    assert!((ten.load.total - 10.0 * one.load.total).abs() < 1e-9);
}

// ── The circuit blocks ──────────────────────────────────────────────────────

/// A room applies a load; reading that load back gives the same two numbers.
///
/// The inverse property is the whole reason `apply_load` splits the way it does.
/// A `c_p,ma` formulation would come back a fraction of a percent out, and a
/// designer who states 20 kW and reads 20.06 kW has no way to tell which of the
/// two the equipment should be sized against.
#[test]
fn a_load_applied_and_read_back_is_the_load_that_was_applied() {
    let atm = sea_level();
    let supply = at(13.0, 0.90);
    let mdot = 1.772;

    let r = process::apply_load(&supply, 20.0, 5.0, mdot, &atm).expect("a room");

    assert!(
        (r.load.sensible - 20.0).abs() < 1e-9,
        "sensible came back as {:.6}",
        r.load.sensible
    );
    assert!(
        (r.load.latent - 5.0).abs() < 1e-9,
        "latent came back as {:.6}",
        r.load.latent
    );
    assert!((r.load.total - 25.0).abs() < 1e-9);
    // And the air left warmer and wetter, which is what a space gain does.
    assert!(r.outlet.t_db > supply.t_db);
    assert!(r.outlet.w > supply.w);
    assert!((r.load.shr.expect("a ratio") - 0.8).abs() < 1e-9);
}

/// A purely sensible room is the data-centre case, and moves no moisture at all.
#[test]
fn a_sensible_only_load_holds_the_humidity_ratio() {
    let atm = sea_level();
    let supply = at(18.0, 0.45);
    let r = process::apply_load(&supply, 40.0, 0.0, 3.0, &atm).expect("a server hall");
    assert!((r.outlet.w - supply.w).abs() < 1e-12);
    assert_eq!(r.load.shr.map(|s| (s - 1.0).abs() < 1e-9), Some(true));
}

/// A split divides the flow and moves nothing else.
#[test]
fn a_split_divides_the_flow_and_leaves_the_state_alone() {
    let atm = sea_level();
    let inlet = at(24.0, 0.50);
    let r = process::split(&inlet, 0.3, 2.0);

    assert!((r.mdot_first - 0.6).abs() < 1e-12);
    assert!((r.mdot_second - 1.4).abs() < 1e-12);
    // Same air down both branches: a relief damper does not condition anything.
    assert!((r.outlet.h - inlet.h).abs() < 1e-12);
    assert!((r.outlet.w - inlet.w).abs() < 1e-12);
    // Mass is conserved, which is the only thing a split can get wrong.
    assert!((r.mdot_first + r.mdot_second - 2.0).abs() < 1e-12);
    let _ = atm;
}

/// A fraction outside [0, 1] is clamped rather than producing a negative flow.
#[test]
fn a_split_cannot_send_more_air_than_it_was_given() {
    let inlet = at(24.0, 0.50);
    for fraction in [-0.5, 1.5] {
        let r = process::split(&inlet, fraction, 2.0);
        assert!(r.mdot_first >= 0.0 && r.mdot_second >= 0.0, "negative flow");
        assert!((r.mdot_first + r.mdot_second - 2.0).abs() < 1e-12);
    }
}
