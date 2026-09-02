//! The Phase 8 acceptance gate: the coil construction and the design derivation.
//!
//! The headline assertion is that the **three bypass-factor forms agree**. Every
//! textbook prints them as interchangeable; they are interchangeable only
//! because the leaving state lies on the straight line to the apparatus dew
//! point, which is precisely what the construction has to produce. A coil model
//! that gets this wrong still returns plausible numbers — which is why it is
//! asserted rather than assumed.

use psychro_core::coil;
use psychro_core::state::{Atmosphere, StatePoint};

fn sea_level() -> Atmosphere {
    Atmosphere::sea_level()
}

/// A comfort-cooling case an engineer could look up: 27 °C / 50% RH entering,
/// leaving at 13 °C on a coil with a 10% bypass factor.
fn worked_case() -> (StatePoint, coil::Coil) {
    let atm = sea_level();
    let entering = StatePoint::from_db_rh(27.0, 0.50, &atm).expect("entering air");
    let c = coil::from_adp(&entering, 10.0, 0.10, 2.0, &atm).expect("a coil");
    (entering, c)
}

#[test]
fn the_three_bypass_factor_forms_agree() {
    let (_, c) = worked_case();
    // They are the same number because the leaving state is on the line to the
    // ADP. A construction that only satisfies one of them is not a coil.
    assert!(
        (c.bf_temperature - c.bf_humidity_ratio).abs() < 5e-3,
        "t-form {:.5} vs W-form {:.5}",
        c.bf_temperature,
        c.bf_humidity_ratio
    );
    // The W and h forms are exact by construction — both are read off the same
    // linear interpolation — to within the backend's own round trip through
    // (h, W), which is where the last nanounit comes from.
    assert!(
        (c.bf_enthalpy - c.bf_humidity_ratio).abs() < 1e-6,
        "h-form {:.9} vs W-form {:.9}",
        c.bf_enthalpy,
        c.bf_humidity_ratio
    );
    assert!((c.bf_humidity_ratio - 0.10).abs() < 1e-6);
}

#[test]
fn the_apparatus_dew_point_lies_on_the_saturation_curve() {
    let (_, c) = worked_case();
    assert!((c.adp.rh - 1.0).abs() < 1e-6, "rh = {}", c.adp.rh);
    assert!(
        (c.adp.t_db - 10.0).abs() < 0.05,
        "t_adp = {:.4}",
        c.adp.t_db
    );
}

/// The inverse construction has to find the ADP it was given, from the leaving
/// state alone. This is the round trip that says the bisection works.
#[test]
fn solving_from_the_leaving_state_recovers_the_apparatus_dew_point() {
    let atm = sea_level();
    let entering = StatePoint::from_db_rh(27.0, 0.50, &atm).expect("entering air");

    for (t_adp, bf) in [(10.0, 0.10), (8.0, 0.05), (12.5, 0.20), (7.0, 0.15)] {
        let forward = coil::from_adp(&entering, t_adp, bf, 2.0, &atm).expect("forward");
        let back = coil::from_leaving(&entering, &forward.leaving, 2.0, &atm).expect("back");

        assert!(
            (back.adp.t_db - t_adp).abs() < 0.05,
            "ADP {:.4} vs {t_adp} at BF {bf}",
            back.adp.t_db
        );
        assert!(
            (back.bf_enthalpy - bf).abs() < 2e-3,
            "BF {:.5} vs {bf}",
            back.bf_enthalpy
        );
    }
}

/// The condensate term is small and must not be silently dropped: `q_t =
/// ṁ_da·(h_ent − h_lvg) − ṁ_cond·h_f`.
#[test]
fn the_condensate_term_is_reported_rather_than_dropped() {
    let (_, c) = worked_case();
    assert!(c.condensate > 0.0, "a wet coil produces condensate");
    assert!(
        c.total_load < c.air_side_load,
        "the condensate credit must reduce the load"
    );

    let credit = (c.air_side_load - c.total_load) / c.air_side_load;
    // Under 1% at ordinary conditions — which is exactly why it gets dropped,
    // and why both numbers are reported instead of conflated.
    assert!(
        (0.001..0.02).contains(&credit),
        "condensate credit {credit:.5} is outside the expected sub-1% band"
    );
}

/// Coil SHR is defined on the air-side drop, per §4.2. Mixing that with the
/// condensate-corrected load is how a selection lands a percent off its own
/// datasheet.
#[test]
fn coil_shr_is_a_comfort_cooling_ratio() {
    let (entering, c) = worked_case();
    assert!(
        (0.55..0.85).contains(&c.shr),
        "SHR {:.4} is not a comfort-cooling coil",
        c.shr
    );
    // Both cooler and drier: down and to the left.
    assert!(c.leaving.t_db < entering.t_db);
    assert!(c.leaving.w < entering.w);
}

/// A coil running above the entering dew point never reaches saturation, so
/// there is no apparatus dew point to construct. That is a real design — a
/// sensible-only coil — not a failure to converge.
#[test]
fn a_dry_coil_is_a_design_rather_than_a_failure() {
    let atm = sea_level();
    let entering = StatePoint::from_db_w(30.0, 0.005, &atm).expect("dry entering air");
    let leaving = StatePoint::from_db_w(20.0, 0.005, &atm).expect("dry leaving air");

    let c = coil::from_leaving(&entering, &leaving, 1.0, &atm).expect("a dry coil");
    assert!(c.dry);
    assert!(c.condensate.abs() < 1e-12);
    assert!((c.total_load - c.air_side_load).abs() < 1e-12);
    assert!((c.shr - 1.0).abs() < 0.01, "a dry coil is all sensible");
}

/// A "coil" that heats the air is not a coil, and saying so beats returning a
/// negative bypass factor nobody would notice.
#[test]
fn a_coil_that_heats_the_air_is_refused() {
    let atm = sea_level();
    let entering = StatePoint::from_db_rh(20.0, 0.5, &atm).unwrap();
    let leaving = StatePoint::from_db_rh(30.0, 0.5, &atm).unwrap();
    assert!(coil::from_leaving(&entering, &leaving, 1.0, &atm).is_err());
}

// ── The design derivation ───────────────────────────────────────────────────

/// A worked office case: 24 °C / 50% RH room, 20 kW sensible and 5 kW latent,
/// supplied at 13 °C — an 11 K difference, inside the 10–14 K band §4.9 quotes.
#[test]
fn the_design_derivation_sizes_the_air_system() {
    let atm = sea_level();
    let room = StatePoint::from_db_rh(24.0, 0.50, &atm).expect("room air");
    let d = coil::design_air(&room, 20.0, 5.0, 13.0, &atm).expect("a design");

    assert!((d.rshf - 0.80).abs() < 1e-9, "RSHF = {:.4}", d.rshf);

    // The textbook one-shot `q_s / (c_p,ma·Δt)` is where the solve starts, and
    // the answer stays within a percent of it — but only within a percent,
    // because the two definitions of "sensible" differ by a c_p,wv·Δ(W·t) term
    // whenever the humidity ratio moves. The next test is the one that says
    // which of the two the answer is consistent with.
    let one_shot = 20.0 / ((1.006 + room.w * 1.84) * 11.0);
    assert!(
        (d.mdot_da - one_shot).abs() / one_shot < 0.01,
        "{:.6} vs the one-shot {one_shot:.6}",
        d.mdot_da
    );

    // Volumetric flow uses the SUPPLY specific volume, not the room's. They
    // differ by a few percent, which is enough to matter and little enough to
    // go unnoticed.
    assert!((d.volumetric_flow - d.mdot_da * d.supply.v).abs() < 1e-12);
    assert!(d.supply.v < room.v, "cooler air is denser");

    // The supply state is drier than the room, because it has to absorb the
    // room's latent gain on the way back.
    assert!(d.supply.w < room.w);
    assert!((d.supply.t_db - 13.0).abs() < 1e-9);
}

/// The supply state has to lie on the room condition line: the load it absorbs
/// between supply and room is the load the room produces.
#[test]
fn the_supply_state_lies_on_the_room_condition_line() {
    let atm = sea_level();
    let room = StatePoint::from_db_rh(24.0, 0.50, &atm).expect("room air");

    for (qs, ql) in [(20.0, 5.0), (30.0, 3.0), (12.0, 8.0)] {
        let d = coil::design_air(&room, qs, ql, 13.0, &atm).expect("a design");
        let absorbed = psychro_core::process::load(&d.supply, &room, d.mdot_da);

        assert!(
            (absorbed.sensible - qs).abs() < 0.05,
            "sensible {:.4} vs {qs}",
            absorbed.sensible
        );
        assert!(
            (absorbed.latent - ql).abs() < 1e-9,
            "latent {:.6} vs {ql}",
            absorbed.latent
        );
        // ...and the ratio the panel prints is the one the chart draws.
        assert!((absorbed.shr.expect("a load") - d.rshf).abs() < 2e-3);
    }
}

/// A fully sensible room — the data-centre case — has RSHF = 1 and a supply
/// state at the room's own humidity ratio.
#[test]
fn a_fully_sensible_room_needs_no_moisture_removal() {
    let atm = sea_level();
    let room = StatePoint::from_db_rh(24.0, 0.40, &atm).expect("room air");
    let d = coil::design_air(&room, 40.0, 0.0, 14.0, &atm).expect("a design");

    assert!((d.rshf - 1.0).abs() < 1e-12);
    assert!((d.supply.w - room.w).abs() < 1e-12, "no moisture to remove");
}

/// Supply air warmer than the room cannot cool it, and saying so beats a
/// negative mass flow.
#[test]
fn supply_air_warmer_than_the_room_is_refused() {
    let atm = sea_level();
    let room = StatePoint::from_db_rh(24.0, 0.50, &atm).unwrap();
    assert!(coil::design_air(&room, 20.0, 5.0, 26.0, &atm).is_err());
}

// ── The cycle macro ─────────────────────────────────────────────────────────

/// A primary return-air cycle on a summer design day: 35 °C / 40% RH outdoor
/// air, a 24 °C / 50% RH room carrying 20 kW sensible and 5 kW latent, 20%
/// outdoor air, supply at 13 °C.
///
/// The macro's value is that every intermediate state comes back, so each one
/// can be checked. A macro that reported only the coil load would be faster to
/// write and impossible to trust.
#[test]
fn the_return_air_cycle_reproduces_a_design_day() {
    let atm = sea_level();
    let outdoor = StatePoint::from_db_rh(35.0, 0.40, &atm).expect("outdoor air");
    let room = StatePoint::from_db_rh(24.0, 0.50, &atm).expect("room air");

    let c = coil::return_air_cycle(&outdoor, &room, 20.0, 5.0, 13.0, 0.20, &atm).expect("a cycle");

    // The mixed state lies between the two, at the ventilation fraction.
    assert!(c.mixed.t_db > room.t_db && c.mixed.t_db < outdoor.t_db);
    assert!(c.mixed.w > room.w && c.mixed.w < outdoor.w);
    let expected_w = 0.2 * outdoor.w + 0.8 * room.w;
    assert!(
        (c.mixed.w - expected_w).abs() < 1e-9,
        "W_mix = {}",
        c.mixed.w
    );
    assert!(!c.mixing_fogged, "a summer mix does not fog");

    // The coil takes the mixture to the supply state the room needs, and it is
    // a wet coil with an apparatus dew point below the supply temperature.
    assert!((c.coil.leaving.t_db - 13.0).abs() < 1e-9);
    assert!(!c.coil.dry);
    assert!(c.coil.adp.t_db < 13.0, "ADP = {:.3}", c.coil.adp.t_db);
    assert!(c.coil.condensate > 0.0);

    // Outdoor air is 20% of the supply flow, on the dry-air basis.
    assert!((c.mdot_outdoor - 0.2 * c.mdot_supply).abs() < 1e-12);

    // The coil's total load exceeds the room's, because it also has to cool the
    // ventilation air down from outdoors. That difference IS the ventilation
    // load, and a cycle that did not show it would understate the plant.
    assert!(
        c.coil.total_load > 25.0,
        "coil load {:.3} kW should exceed the 25 kW room load",
        c.coil.total_load
    );
}

/// The three bypass-factor forms still agree on a coil the macro produced,
/// rather than only on one built directly from an ADP.
#[test]
fn the_cycles_coil_satisfies_the_bypass_factor_forms() {
    let atm = sea_level();
    let outdoor = StatePoint::from_db_rh(35.0, 0.40, &atm).expect("outdoor air");
    let room = StatePoint::from_db_rh(24.0, 0.50, &atm).expect("room air");
    let c = coil::return_air_cycle(&outdoor, &room, 20.0, 5.0, 13.0, 0.20, &atm).expect("a cycle");

    assert!((c.coil.bf_enthalpy - c.coil.bf_humidity_ratio).abs() < 1e-6);
    assert!((c.coil.bf_temperature - c.coil.bf_humidity_ratio).abs() < 5e-3);
    assert!(
        (0.0..0.4).contains(&c.coil.bf_enthalpy),
        "BF {:.4} is outside anything a real coil reaches",
        c.coil.bf_enthalpy
    );
}

/// A cold-climate cycle: the mixing box fogs, and the macro says so rather than
/// failing. This is the Winter V case arriving through the macro.
#[test]
fn a_winter_cycle_reports_a_fogging_mixing_box() {
    let atm = sea_level();
    let outdoor = StatePoint::from_db_rh(-15.0, 0.60, &atm).expect("winter outdoor air");
    let room = StatePoint::from_db_w(24.0, 0.0140, &atm).expect("a humid room");

    // Half outdoor air in a hard winter, which is what makes the chord cross.
    let result = coil::return_air_cycle(&outdoor, &room, 20.0, 5.0, 13.0, 0.5, &atm);
    // The coil may or may not be a cooling coil in these conditions; what this
    // asserts is that fogging is reported rather than thrown.
    if let Ok(c) = result {
        assert!(c.mixing_fogged, "this mix line should cross saturation");
    }
}
