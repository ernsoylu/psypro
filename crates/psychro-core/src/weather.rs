//! Weather data: binning 8760 hours, and counting what they mean.
//!
//! A year of hourly weather is 8760 points, and drawing them as 8760 markers
//! produces a smear rather than a picture — the interesting information is
//! *density*, which is where the climate actually sits. So the hours are binned
//! into a grid and the grid is drawn.
//!
//! # Why this happens here rather than in TypeScript
//!
//! Because the bin a row belongs to depends on its **humidity ratio**, and an
//! EPW file does not carry one. It carries a dew point, and turning a dew point
//! into a humidity ratio is a property evaluation at the station's own pressure.
//! Binning on dry bulb and dew point instead would put rows in the wrong cells —
//! the mapping is not linear — and the error would look like a slightly
//! different climate rather than like a bug. "Economiser hours" is a comparison
//! of *enthalpies*, for the same reason.
//!
//! # Why the year is resolved once
//!
//! The first version called [`StatePoint::from_db_dp`] per row per analysis.
//! That resolves all ten properties — including a thermodynamic wet bulb, which
//! is an iterative solve — and it ran four times over the year: once to bin,
//! once for free cooling, once per visible envelope. A browser trace measured
//! **39 seconds of blocked main thread** on one 8760-hour file.
//!
//! So the year is resolved **once**, into the four quantities every analysis
//! actually needs, and each question is then a scan over plain numbers. The wet
//! bulb — by far the most expensive of them — is computed only for the hours
//! that reach the test which needs it.

use crate::backend;
use crate::state::{saturation_humidity_ratio, Atmosphere};

/// A year of weather with its properties already resolved.
///
/// Built once and reused by every analysis. The point is not tidiness: each of
/// these is a property evaluation, and doing them per question rather than per
/// hour is the difference between a responsive page and a frozen one.
#[derive(Debug, Clone, Default)]
pub struct ResolvedYear {
    /// Dry-bulb temperature per hour, °C.
    pub t_db: Vec<f64>,
    /// Dew-point temperature per hour, °C.
    pub t_dp: Vec<f64>,
    /// Humidity ratio per hour, kg/kg_da.
    pub w: Vec<f64>,
    /// Specific enthalpy per hour, kJ/kg_da.
    pub h: Vec<f64>,
    /// Relative humidity per hour, fraction.
    pub rh: Vec<f64>,
    /// Rows the engine could not resolve.
    pub skipped: usize,
    /// The atmosphere they were resolved against.
    pub atm: Atmosphere,
}

impl ResolvedYear {
    /// Hours that resolved.
    #[must_use]
    pub fn len(&self) -> usize {
        self.t_db.len()
    }

    /// Whether no hour resolved.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.t_db.is_empty()
    }
}

/// Resolves a year of `(dry bulb, dew point)` observations.
///
/// A row whose dew point exceeds its dry bulb is not weather; it is a
/// transcription error, and those are common enough in third-party EPW files
/// that dropping them silently would hide a real data problem. They are counted
/// in `skipped` instead.
#[must_use]
pub fn resolve_year(dry_bulb: &[f64], dew_point: &[f64], atm: &Atmosphere) -> ResolvedYear {
    let n = dry_bulb.len().min(dew_point.len());
    let mut year = ResolvedYear {
        atm: *atm,
        ..ResolvedYear::default()
    };
    year.t_db.reserve(n);
    year.t_dp.reserve(n);
    year.w.reserve(n);
    year.h.reserve(n);
    year.rh.reserve(n);

    for i in 0..n {
        let (t, dp) = (dry_bulb[i], dew_point[i]);
        // The dew point cannot exceed the dry bulb: that state does not exist.
        if !t.is_finite() || !dp.is_finite() || dp > t + 1e-9 {
            year.skipped += 1;
            continue;
        }
        // The dew point IS a humidity ratio: it is the temperature at which the
        // air's own vapour saturates, so its saturated ratio is the air's.
        let w = saturation_humidity_ratio(dp, atm);
        let w_s = saturation_humidity_ratio(t, atm);
        let Ok(h) = enthalpy_of(t, w, atm) else {
            year.skipped += 1;
            continue;
        };
        year.t_db.push(t);
        year.t_dp.push(dp);
        year.w.push(w);
        year.h.push(h);
        // Degree of saturation is a good enough stand-in for relative humidity
        // at an envelope's tolerance and costs no property call, but the two are
        // NOT the same quantity — so this asks for the real one.
        year.rh.push(if w_s > 0.0 {
            relative_humidity_of(t, w, atm).unwrap_or(w / w_s)
        } else {
            0.0
        });
    }
    year
}

/// Specific enthalpy, through the backend or the reference implementation.
fn enthalpy_of(t_db: f64, w: f64, atm: &Atmosphere) -> Result<f64, backend::PropertyError> {
    if atm.real_gas {
        backend::enthalpy(t_db, w, atm.p_bar)
    } else {
        Ok(crate::state::enthalpy(t_db, w))
    }
}

/// Relative humidity, through the backend or the reference implementation.
fn relative_humidity_of(
    t_db: f64,
    w: f64,
    atm: &Atmosphere,
) -> Result<f64, backend::PropertyError> {
    if atm.real_gas {
        backend::relative_humidity(t_db, w, atm.p_bar)
    } else {
        Ok(crate::state::relative_humidity(t_db, w, atm))
    }
}

/// Thermodynamic wet bulb, which is an iterative solve and the expensive one.
fn wet_bulb_of(t_db: f64, w: f64, atm: &Atmosphere) -> Result<f64, backend::PropertyError> {
    if atm.real_gas {
        backend::wet_bulb(t_db, w, atm.p_bar)
    } else {
        Ok(crate::state::wet_bulb(t_db, w, atm))
    }
}

/// A two-dimensional histogram of hours over the chart's own coordinates.
#[derive(Debug, Clone)]
pub struct Bins {
    /// Dry-bulb temperature at the left edge of column 0, °C.
    pub t_min: f64,
    /// Humidity ratio at the bottom edge of row 0, kg/kg_da.
    pub w_min: f64,
    /// Column width, K.
    pub t_step: f64,
    /// Row height, kg/kg_da.
    pub w_step: f64,
    /// Number of columns.
    pub t_count: usize,
    /// Number of rows.
    pub w_count: usize,
    /// Hours per cell, row-major: `counts[row * t_count + column]`.
    pub counts: Vec<u32>,
    /// The busiest cell's count, so a renderer can scale without a second pass.
    pub peak: u32,
    /// Hours that landed in a cell.
    pub binned: usize,
    /// Rows the engine could not resolve.
    pub skipped: usize,
}

/// Bins a resolved year into a grid.
///
/// `t_step` is the dry-bulb increment — `REQUIREMENTS.md` §5 asks for 0.5 to
/// 6 degrees — and `w_step` the humidity-ratio increment.
#[must_use]
pub fn bin(year: &ResolvedYear, t_step: f64, w_step: f64) -> Bins {
    if year.is_empty() || t_step <= 0.0 || w_step <= 0.0 {
        return Bins {
            t_min: 0.0,
            w_min: 0.0,
            t_step,
            w_step,
            t_count: 0,
            w_count: 0,
            counts: Vec::new(),
            peak: 0,
            binned: 0,
            skipped: year.skipped,
        };
    }

    // The grid is snapped to multiples of the step rather than to the data's own
    // extremes, so two files binned at the same increment share a lattice and
    // can be compared cell for cell.
    let snap_down = |v: f64, step: f64| (v / step).floor() * step;
    let t_lo = snap_down(
        year.t_db.iter().fold(f64::INFINITY, |a, t| a.min(*t)),
        t_step,
    );
    let t_hi = year.t_db.iter().fold(f64::NEG_INFINITY, |a, t| a.max(*t));
    let w_lo = snap_down(year.w.iter().fold(f64::INFINITY, |a, w| a.min(*w)), w_step);
    let w_hi = year.w.iter().fold(f64::NEG_INFINITY, |a, w| a.max(*w));

    let t_count = (((t_hi - t_lo) / t_step).ceil() as usize + 1).max(1);
    let w_count = (((w_hi - w_lo) / w_step).ceil() as usize + 1).max(1);

    let mut counts = vec![0u32; t_count * w_count];
    for i in 0..year.len() {
        let col = (((year.t_db[i] - t_lo) / t_step) as usize).min(t_count - 1);
        let row = (((year.w[i] - w_lo) / w_step) as usize).min(w_count - 1);
        counts[row * t_count + col] += 1;
    }

    Bins {
        t_min: t_lo,
        w_min: w_lo,
        t_step,
        w_step,
        t_count,
        w_count,
        peak: counts.iter().copied().max().unwrap_or(0),
        counts,
        binned: year.len(),
        skipped: year.skipped,
    }
}

/// What a year of weather means for a given design.
///
/// The counts are mutually exclusive and sum to the year, so a reader can treat
/// them as a breakdown rather than as four unrelated numbers.
#[derive(Debug, Clone, Copy, Default)]
pub struct HourAnalysis {
    /// Hours cool enough to cool the building on outdoor air alone.
    pub economizer: u32,
    /// Hours where evaporative cooling alone would reach the supply condition.
    pub evaporative: u32,
    /// Hours needing mechanical cooling.
    pub mechanical: u32,
    /// Hours needing heating rather than cooling.
    pub heating: u32,
    /// Hours the engine could not resolve.
    pub skipped: u32,
}

/// The design thresholds an hour count is taken against.
#[derive(Debug, Clone, Copy)]
pub struct FreeCooling {
    /// Supply dry-bulb the system has to reach, °C.
    pub t_supply: f64,
    /// Return-air enthalpy the economiser compares against, kJ/kg_da.
    pub h_return: f64,
    /// Fixed high limit above which the economiser locks out, °C.
    pub t_high_limit: f64,
    /// Wet-bulb depression effectiveness of the evaporative stage, 0 to 1.
    pub evaporative_effectiveness: f64,
}

/// Counts the free-cooling hours in a resolved year.
///
/// The order of the tests is the order a control sequence would try them, and
/// that ordering is the result: an hour an economiser can serve is *not* also
/// counted as an evaporative hour, because the economiser is cheaper and would
/// run first. Counting each strategy independently produces three numbers that
/// sum to more than a year, which is a real and common way to overstate a
/// free-cooling case.
///
/// The wet bulb is evaluated **only** for the hours that reach the evaporative
/// test. It is an iterative solve, it is the most expensive property in the
/// engine, and most hours never need it.
#[must_use]
pub fn free_cooling_hours(year: &ResolvedYear, design: &FreeCooling) -> HourAnalysis {
    let mut out = HourAnalysis {
        skipped: year.skipped as u32,
        ..HourAnalysis::default()
    };

    for i in 0..year.len() {
        let (t, h, w) = (year.t_db[i], year.h[i], year.w[i]);
        if t < design.t_supply {
            // Colder than the supply condition: this hour needs heat, not
            // cooling, and calling it free cooling would flatter the result.
            out.heating += 1;
        } else if h < design.h_return && t <= design.t_high_limit {
            out.economizer += 1;
        } else {
            let Ok(t_wb) = wet_bulb_of(t, w, &year.atm) else {
                out.mechanical += 1;
                continue;
            };
            // Evaporative cooling drives the dry bulb toward the entering wet
            // bulb; it serves the hour if it reaches the supply condition.
            let reachable = t - design.evaporative_effectiveness * (t - t_wb);
            if reachable <= design.t_supply {
                out.evaporative += 1;
            } else {
                out.mechanical += 1;
            }
        }
    }

    out
}

/// Counts the hours a resolved year spends inside an envelope.
///
/// A different question from free cooling: not "what can cool this?" but "how
/// often is the outdoor air itself already acceptable?" — which is what §10.3
/// asks of a data centre.
#[must_use]
pub fn hours_inside(year: &ResolvedYear, limits: &crate::envelope::Limits) -> u32 {
    let within = |value: f64, min: Option<f64>, max: Option<f64>| {
        min.is_none_or(|m| value >= m) && max.is_none_or(|m| value <= m)
    };
    let mut inside = 0;
    for i in 0..year.len() {
        if year.t_db[i] < limits.t_min || year.t_db[i] > limits.t_max {
            continue;
        }
        if within(year.t_dp[i], limits.dp_min, limits.dp_max)
            && within(year.rh[i], limits.rh_min, limits.rh_max)
            && within(year.w[i], limits.w_min, limits.w_max)
        {
            inside += 1;
        }
    }
    inside
}
