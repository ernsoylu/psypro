//! Chart-space geometry: invertibility, the oblique construction, and the cost
//! of regenerating a full grid.
//!
//! The round-trip test is the load-bearing one. Dragging a point runs
//! screen → chart → properties → store → chart → screen every pointer move, so
//! any asymmetry between the forward and inverse maps shows up as a point that
//! drifts under the cursor.

use approx::assert_relative_eq;
use psychro_core::chart::{
    bounds, from_chart, generate_grid, reduced_coordinate, temperature_from_reduced, to_chart,
    ChartDomain, ChartLayout, ChartPoint, CurveFamily, GridSpec,
};
use psychro_core::constants::{CP_WV, H_G_REF};
use psychro_core::state::{enthalpy, Atmosphere};

const LAYOUTS: [ChartLayout; 2] = [ChartLayout::Ashrae, ChartLayout::MollierIx];

/// `from_chart(to_chart(p)) == p` across the whole domain, for both layouts.
#[test]
fn chart_mapping_round_trips() {
    for layout in LAYOUTS {
        let mut t = -20.0_f64;
        while t <= 60.0 {
            let mut w = 0.0_f64;
            while w <= 0.040 {
                let p = to_chart(t, w, layout);
                let (t_back, w_back) = from_chart(p, layout);
                assert_relative_eq!(t_back, t, epsilon = 1e-12, max_relative = 1e-12);
                assert_relative_eq!(w_back, w, epsilon = 1e-15);
                w += 0.002;
            }
            t += 2.5;
        }
    }
}

/// ...and the other direction: chart → properties → chart.
#[test]
fn inverse_mapping_round_trips() {
    for layout in LAYOUTS {
        for &(x, y) in &[(10.0, 0.005), (35.0, 0.015), (-5.0, 0.001), (50.0, 0.03)] {
            let p = match layout {
                ChartLayout::Ashrae => ChartPoint { x, y },
                ChartLayout::MollierIx => ChartPoint { x: y, y: x },
            };
            let (t, w) = from_chart(p, layout);
            let back = to_chart(t, w, layout);
            assert_relative_eq!(back.x, p.x, epsilon = 1e-12);
            assert_relative_eq!(back.y, p.y, epsilon = 1e-12);
        }
    }
}

/// The reduced coordinate is exactly `h − h_g,ref·W`.
#[test]
fn reduced_coordinate_is_enthalpy_less_latent_reference() {
    for &(t, w) in &[(24.0, 0.0093), (-8.0, 0.001), (45.0, 0.028)] {
        assert_relative_eq!(
            reduced_coordinate(t, w),
            enthalpy(t, w) - H_G_REF * w,
            epsilon = 1e-9
        );
    }
    assert_relative_eq!(
        temperature_from_reduced(reduced_coordinate(24.0, 0.01), 0.01),
        24.0,
        epsilon = 1e-12
    );
}

/// Constant-enthalpy lines are straight **and parallel** in chart space, with
/// slope `−h_g,ref`. This is what the oblique construction buys.
#[test]
fn enthalpy_lines_are_straight_and_parallel() {
    let w_of = |h: f64, t: f64| (h - 1.006 * t) / (H_G_REF + CP_WV * t);
    let mut slopes = Vec::new();
    for h in [20.0_f64, 50.0, 90.0] {
        // Three points on the same isenthalp.
        let pts: Vec<ChartPoint> = [5.0_f64, 20.0, 35.0]
            .iter()
            .map(|&t| to_chart(t, w_of(h, t), ChartLayout::Ashrae))
            .collect();
        let s1 = (pts[1].x - pts[0].x) / (pts[1].y - pts[0].y);
        let s2 = (pts[2].x - pts[1].x) / (pts[2].y - pts[1].y);
        assert_relative_eq!(s1, s2, max_relative = 1e-9);
        assert_relative_eq!(s1, -H_G_REF, max_relative = 1e-9);
        slopes.push(s1);
    }
    // Parallel across different enthalpies too.
    assert_relative_eq!(slopes[0], slopes[2], max_relative = 1e-9);
}

/// Constant dry-bulb lines are straight but **not** parallel — they fan out with
/// temperature. That divergence is the chart's visible skew, and it must not be
/// "corrected" away.
#[test]
fn dry_bulb_lines_are_straight_but_not_parallel() {
    let slope_at = |t: f64| {
        let a = to_chart(t, 0.000, ChartLayout::Ashrae);
        let b = to_chart(t, 0.010, ChartLayout::Ashrae);
        let c = to_chart(t, 0.020, ChartLayout::Ashrae);
        let s1 = (b.x - a.x) / (b.y - a.y);
        let s2 = (c.x - b.x) / (c.y - b.y);
        assert_relative_eq!(s1, s2, epsilon = 1e-9); // straight
        s1
    };
    // Slope is c_p,wv · t, so the 0 °C isotherm is vertical and the rest lean.
    assert_relative_eq!(slope_at(0.0), 0.0, epsilon = 1e-9);
    assert_relative_eq!(slope_at(20.0), CP_WV * 20.0, max_relative = 1e-9);
    assert_relative_eq!(slope_at(40.0), CP_WV * 40.0, max_relative = 1e-9);
    assert!(slope_at(40.0) > slope_at(20.0), "isotherms must fan out");
}

/// The Mollier layout is the ASHRAE reduced space with the axes exchanged, and
/// its defining feature is a horizontal 0 °C isotherm.
#[test]
fn mollier_is_the_axis_swap_and_zero_isotherm_is_horizontal() {
    for &(t, w) in &[(24.0, 0.009), (0.0, 0.004), (40.0, 0.02)] {
        let a = to_chart(t, w, ChartLayout::Ashrae);
        let m = to_chart(t, w, ChartLayout::MollierIx);
        assert_relative_eq!(m.x, a.y, epsilon = 1e-15);
        assert_relative_eq!(m.y, a.x, epsilon = 1e-15);
    }
    // Every state at 0 °C sits at y = 0 in Mollier, whatever its humidity.
    for w in [0.0, 0.005, 0.02] {
        assert_relative_eq!(
            to_chart(0.0, w, ChartLayout::MollierIx).y,
            0.0,
            epsilon = 1e-12
        );
    }
}

/// Bounds cover the domain corners; the reduced coordinate's `W` dependence
/// means the extremes are not simply at the temperature limits.
#[test]
fn bounds_enclose_the_domain() {
    let d = ChartDomain::default();
    for layout in LAYOUTS {
        let b = bounds(&d, layout);
        let mut t = d.t_min;
        while t <= d.t_max {
            let mut w = d.w_min;
            while w <= d.w_max {
                let p = to_chart(t, w, layout);
                assert!(p.x >= b.x_min - 1e-9 && p.x <= b.x_max + 1e-9);
                assert!(p.y >= b.y_min - 1e-9 && p.y <= b.y_max + 1e-9);
                w += 0.005;
            }
            t += 5.0;
        }
        assert!(b.x_max > b.x_min && b.y_max > b.y_min);
    }
}

/// Straight families emit two points; curved families emit a polyline.
#[test]
fn straight_families_emit_two_points() {
    let curves = generate_grid(
        &ChartDomain::default(),
        ChartLayout::Ashrae,
        &Atmosphere::sea_level(),
        &GridSpec::default(),
    );
    assert!(!curves.is_empty());
    for c in &curves {
        if c.family.is_straight_in_chart_space() {
            assert_eq!(
                c.points.len(),
                2,
                "{:?} at {} should need only endpoints",
                c.family,
                c.value
            );
        }
    }
    // And every family is represented.
    for f in [
        CurveFamily::DryBulb,
        CurveFamily::HumidityRatio,
        CurveFamily::RelativeHumidity,
        CurveFamily::WetBulb,
        CurveFamily::Enthalpy,
        CurveFamily::SpecificVolume,
    ] {
        assert!(curves.iter().any(|c| c.family == f), "missing {f:?}");
    }
}

/// No generated point may sit above saturation: that is not moist air.
#[test]
fn generated_curves_stay_at_or_below_saturation() {
    let atm = Atmosphere::sea_level();
    let d = ChartDomain::default();
    let curves = generate_grid(&d, ChartLayout::Ashrae, &atm, &GridSpec::default());
    for c in &curves {
        // The saturation curve itself is the boundary, so allow it exactly.
        let tol = if c.family == CurveFamily::RelativeHumidity && c.value >= 1.0 {
            1e-6
        } else {
            1e-9
        };
        for p in &c.points {
            let (t, w) = from_chart(*p, ChartLayout::Ashrae);
            let w_s = psychro_core::state::saturation_humidity_ratio(t, &atm);
            assert!(
                w <= w_s * (1.0 + tol) + 1e-12,
                "{:?} at {} exceeds saturation: W={w:.6} > Ws={w_s:.6} at t={t:.2}",
                c.family,
                c.value
            );
        }
    }
}

/// A full grid regeneration must be far cheaper than a frame.
///
/// Layer 0 is cached and only regenerates when units, altitude or layout change,
/// so this is a guard against a pathological regression rather than a hot-path
/// measurement. The bound is deliberately loose to stay stable on shared CI.
#[test]
fn full_grid_regenerates_well_inside_a_frame() {
    let atm = Atmosphere::sea_level();
    let d = ChartDomain::default();
    let spec = GridSpec::default();

    // Warm up, then time repeated regenerations.
    let _ = generate_grid(&d, ChartLayout::Ashrae, &atm, &spec);
    let start = std::time::Instant::now();
    const RUNS: u32 = 10;
    let mut total_points = 0usize;
    for _ in 0..RUNS {
        let curves = generate_grid(&d, ChartLayout::Ashrae, &atm, &spec);
        total_points += curves.iter().map(|c| c.points.len()).sum::<usize>();
    }
    let per_run = start.elapsed() / RUNS;
    assert!(total_points > 0);
    assert!(
        per_run < std::time::Duration::from_millis(16),
        "full grid took {per_run:?} per regeneration, which exceeds one 60 FPS frame"
    );
}
