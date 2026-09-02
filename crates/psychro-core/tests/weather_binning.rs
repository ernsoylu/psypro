//! Binning, and the two ways an hour count goes quietly wrong.

use psychro_core::envelope::Limits;
use psychro_core::state::Atmosphere;
use psychro_core::weather::{self, FreeCooling, ResolvedYear};

fn sea_level() -> Atmosphere {
    Atmosphere::sea_level()
}

/// Resolves the year once, as production does.
fn resolved(db: &[f64], dp: &[f64]) -> ResolvedYear {
    weather::resolve_year(db, dp, &sea_level())
}

/// How many hours the synthetic year carries.
///
/// Every third hour of a real year rather than all 8760: each row costs six
/// backend property calls, and the full year put nearly a minute on a debug
/// `cargo test`. Everything asserted here is a *relationship* between counts —
/// they sum to the sample, a tighter limit moves hours between columns — and
/// none of it depends on the sample being exactly a year. The 8760-row path is
/// exercised for real in the browser, where the performance question lives.
const HOURS: usize = 2920;

/// A year of synthetic weather: a sinusoidal annual swing with a daily one on
/// top, and a dew point that tracks it. Not a real climate, but the right shape
/// and no licensing question attached.
fn synthetic_year() -> (Vec<f64>, Vec<f64>) {
    let mut db = Vec::with_capacity(HOURS);
    let mut dp = Vec::with_capacity(HOURS);
    for step in 0..HOURS {
        let hour = step * 3;
        let day = hour as f64 / 24.0;
        let annual = 12.0 * (2.0 * std::f64::consts::PI * (day - 200.0) / 365.0).sin();
        let daily = 5.0 * (2.0 * std::f64::consts::PI * (hour % 24) as f64 / 24.0).sin();
        let t = 14.0 + annual + daily;
        db.push(t);
        // Dew point below dry bulb, tracking it loosely.
        dp.push(t - 6.0 - 3.0 * (2.0 * std::f64::consts::PI * day / 365.0).cos());
    }
    (db, dp)
}

#[test]
fn every_resolvable_hour_lands_in_exactly_one_cell() {
    let (db, dp) = synthetic_year();
    let b = weather::bin(&resolved(&db, &dp), 1.0, 0.001);

    let total: u32 = b.counts.iter().sum();
    assert_eq!(total as usize, b.binned);
    assert_eq!(b.binned + b.skipped, db.len());
    assert_eq!(b.counts.len(), b.t_count * b.w_count);
    assert!(b.peak > 0);
    assert_eq!(b.peak, b.counts.iter().copied().max().unwrap());
}

#[test]
fn the_grid_is_snapped_so_two_files_share_a_lattice() {
    let (db, dp) = synthetic_year();
    let a = weather::bin(&resolved(&db, &dp), 2.0, 0.001);
    // A second file covering a different range, binned at the same increment.
    let shifted: Vec<f64> = db.iter().map(|t| t + 7.3).collect();
    let shifted_dp: Vec<f64> = dp.iter().map(|t| t + 7.3).collect();
    let b = weather::bin(&resolved(&shifted, &shifted_dp), 2.0, 0.001);

    // Both origins are multiples of the step, so cells line up and two climates
    // can be compared cell for cell rather than only by eye.
    for origin in [a.t_min, b.t_min] {
        assert!(
            (origin / 2.0 - (origin / 2.0).round()).abs() < 1e-9,
            "{origin}"
        );
    }
}

#[test]
fn a_finer_increment_makes_more_cells_and_the_same_hours() {
    let (db, dp) = synthetic_year();
    let coarse = weather::bin(&resolved(&db, &dp), 6.0, 0.002);
    let fine = weather::bin(&resolved(&db, &dp), 0.5, 0.0005);

    // REQUIREMENTS §5 asks for 0.5 to 6 degree increments; both ends work and
    // neither loses an hour.
    assert!(fine.t_count > coarse.t_count * 4);
    assert_eq!(fine.binned, coarse.binned);
}

#[test]
fn a_dew_point_above_the_dry_bulb_is_counted_rather_than_dropped() {
    // Not weather: a transcription error, and common enough in third-party EPW
    // files that silently dropping it would hide a real data problem.
    let db = vec![20.0, 20.0, 20.0];
    let dp = vec![10.0, 25.0, 12.0];
    let b = weather::bin(&resolved(&db, &dp), 1.0, 0.001);
    assert_eq!(b.skipped, 1);
    assert_eq!(b.binned, 2);
}

#[test]
fn free_cooling_hours_are_a_breakdown_rather_than_four_tallies() {
    let (db, dp) = synthetic_year();
    let design = FreeCooling {
        t_supply: 13.0,
        h_return: 47.9,
        t_high_limit: 21.0,
        evaporative_effectiveness: 0.85,
    };
    let a = weather::free_cooling_hours(&resolved(&db, &dp), &design);

    // Mutually exclusive and complete: they sum to the year. Counting each
    // strategy independently gives three numbers that sum to more than a year,
    // which is a common way to overstate a free-cooling case.
    let total = a.economizer + a.evaporative + a.mechanical + a.heating + a.skipped;
    assert_eq!(total as usize, db.len());
    assert!(a.economizer > 0, "a temperate year has economiser hours");
    assert!(a.mechanical > 0, "and hours it cannot serve for free");
}

#[test]
fn an_hour_an_economizer_can_serve_is_not_also_an_evaporative_hour() {
    let (db, dp) = synthetic_year();
    let generous = FreeCooling {
        t_supply: 13.0,
        h_return: 47.9,
        t_high_limit: 24.0,
        evaporative_effectiveness: 0.85,
    };
    let strict = FreeCooling {
        t_high_limit: 15.0,
        ..generous
    };

    let a = weather::free_cooling_hours(&resolved(&db, &dp), &generous);
    let b = weather::free_cooling_hours(&resolved(&db, &dp), &strict);

    // Tightening the economiser's high limit moves hours OUT of the economiser
    // column and into the evaporative or mechanical ones — it cannot create
    // hours, and it cannot leave the total unchanged.
    assert!(b.economizer < a.economizer);
    assert_eq!(
        a.economizer + a.evaporative + a.mechanical,
        b.economizer + b.evaporative + b.mechanical
    );
}

#[test]
fn a_colder_supply_target_needs_more_mechanical_cooling() {
    let (db, dp) = synthetic_year();
    let warm = FreeCooling {
        t_supply: 18.0,
        h_return: 47.9,
        t_high_limit: 21.0,
        evaporative_effectiveness: 0.85,
    };
    let cold = FreeCooling {
        t_supply: 10.0,
        ..warm
    };
    let a = weather::free_cooling_hours(&resolved(&db, &dp), &warm);
    let b = weather::free_cooling_hours(&resolved(&db, &dp), &cold);
    assert!(b.mechanical > a.mechanical);
}

#[test]
fn hours_inside_an_envelope_answers_a_different_question() {
    let (db, dp) = synthetic_year();
    let recommended = Limits {
        t_min: 18.0,
        t_max: 27.0,
        dp_min: Some(-9.0),
        dp_max: Some(15.0),
        rh_max: Some(0.60),
        ..Limits::default()
    };
    let year = resolved(&db, &dp);
    let inside = weather::hours_inside(&year, &recommended);
    assert_eq!(year.skipped, 0);
    assert!(inside > 0 && (inside as usize) < db.len());

    // The wider allowable class contains the recommended one, so it can only
    // have more hours — never fewer.
    let a2 = Limits {
        t_min: 10.0,
        t_max: 35.0,
        dp_max: Some(21.0),
        rh_min: Some(0.20),
        rh_max: Some(0.80),
        ..Limits::default()
    };
    let wider = weather::hours_inside(&year, &a2);
    assert!(wider >= inside, "{wider} vs {inside}");
}
