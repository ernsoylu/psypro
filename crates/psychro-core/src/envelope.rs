//! Envelopes: comfort and equipment zones, as constraints rather than polygons.
//!
//! An envelope is published as a set of *limits* — 18 to 27 °C dry bulb, −9 to
//! +15 °C dew point, at most 60% RH — and that is how it is stored here. The
//! polygon is computed, never authored.
//!
//! That distinction is the whole design. A polygon traced once at sea level is
//! wrong at altitude, wrong on a Mollier chart, and silently wrong rather than
//! visibly so: the relative-humidity bound is a *curve* whose shape depends on
//! barometric pressure, and a stored outline cannot know that. Storing limits
//! means a contributor adds an envelope by writing down what the standard says,
//! and the engine works out where it lands.
//!
//! It is also what lets envelopes ship as data files, which `REQUIREMENTS.md`
//! §5 asks for explicitly.

use crate::state::{saturation_humidity_ratio, Atmosphere, StatePoint};

/// One published limit set.
///
/// Every bound is optional: TC 9.9 Recommended bounds dry bulb, dew point and
/// relative humidity but not humidity ratio, and A1 bounds dry bulb, relative
/// humidity and a maximum dew point but no minimum.
#[derive(Debug, Clone, Copy, Default)]
pub struct Limits {
    /// Dry-bulb bounds, °C. Required: an envelope has to span *something*.
    pub t_min: f64,
    /// Upper dry-bulb bound, °C.
    pub t_max: f64,
    /// Minimum dew point, °C.
    pub dp_min: Option<f64>,
    /// Maximum dew point, °C.
    pub dp_max: Option<f64>,
    /// Minimum relative humidity, fraction.
    pub rh_min: Option<f64>,
    /// Maximum relative humidity, fraction.
    pub rh_max: Option<f64>,
    /// Minimum humidity ratio, kg/kg_da.
    pub w_min: Option<f64>,
    /// Maximum humidity ratio, kg/kg_da.
    pub w_max: Option<f64>,
}

/// How finely the curved bounds are sampled along the dry-bulb axis.
///
/// A relative-humidity bound is a curve, so the polygon needs enough vertices
/// to look like one. Thirty-two over a fifteen-kelvin band is well under a pixel
/// of chord error at any zoom a reader will use.
const SAMPLES: usize = 32;

/// The humidity-ratio band an envelope allows at one dry-bulb temperature.
///
/// The intersection of every bound, expressed in humidity ratio because that is
/// the one coordinate all of them can be converted into. Returns `None` when the
/// bounds contradict each other at this temperature, which is not an error —
/// it is how an envelope's ends are found.
fn band(t_db: f64, limits: &Limits, atm: &Atmosphere) -> Option<(f64, f64)> {
    let w_s = saturation_humidity_ratio(t_db, atm);
    let mut lo = limits.w_min.unwrap_or(0.0);
    let mut hi = limits.w_max.unwrap_or(w_s);

    // A dew-point bound IS a humidity-ratio bound: dew point is the temperature
    // at which the air's own vapour saturates, so its humidity ratio is the
    // saturated one at that temperature. That equivalence is why the three
    // published bound styles can be intersected at all.
    if let Some(dp) = limits.dp_min {
        lo = lo.max(saturation_humidity_ratio(dp, atm));
    }
    if let Some(dp) = limits.dp_max {
        hi = hi.min(saturation_humidity_ratio(dp, atm));
    }

    // A relative-humidity bound is a fraction of the saturation ratio at *this*
    // temperature, which is what makes it a curve rather than a line.
    if let Some(rh) = limits.rh_min {
        lo = lo.max(rh * w_s);
    }
    if let Some(rh) = limits.rh_max {
        hi = hi.min(rh * w_s);
    }

    // Nothing may sit above saturation, whatever the published limits say.
    hi = hi.min(w_s);
    lo = lo.max(0.0);

    if hi <= lo {
        None
    } else {
        Some((lo, hi))
    }
}

/// A vertex of a resolved envelope, in physical coordinates.
#[derive(Debug, Clone, Copy)]
pub struct Vertex {
    /// Dry-bulb temperature, °C.
    pub t_db: f64,
    /// Humidity ratio, kg/kg_da.
    pub w: f64,
}

/// Resolves an envelope's limits into a closed polygon.
///
/// Walks the upper bound left to right and the lower bound back again, so the
/// result is a single ring a renderer can fill without triangulating anything.
///
/// Returns an empty vector when no temperature in the range satisfies every
/// bound — an envelope that does not exist at this pressure draws as nothing,
/// which is the honest rendering.
#[must_use]
pub fn polygon(limits: &Limits, atm: &Atmosphere) -> Vec<Vertex> {
    let mut upper = Vec::with_capacity(SAMPLES + 2);
    let mut lower = Vec::with_capacity(SAMPLES + 2);

    let span = limits.t_max - limits.t_min;
    if span <= 0.0 {
        return Vec::new();
    }

    for i in 0..=SAMPLES {
        let t = limits.t_min + span * (i as f64) / (SAMPLES as f64);
        if let Some((lo, hi)) = band(t, limits, atm) {
            upper.push(Vertex { t_db: t, w: hi });
            lower.push(Vertex { t_db: t, w: lo });
        }
    }

    if upper.len() < 2 {
        return Vec::new();
    }

    lower.reverse();
    upper.extend(lower);
    upper
}

/// Whether a state lies inside an envelope.
///
/// Evaluated against the *limits*, not against the polygon. Testing a point
/// against a rendered outline would inherit the polygon's sampling error, and
/// the answer to "is this room compliant?" should not depend on how finely the
/// zone was drawn for the screen.
#[must_use]
pub fn contains(state: &StatePoint, limits: &Limits) -> bool {
    if state.t_db < limits.t_min || state.t_db > limits.t_max {
        return false;
    }
    let within = |value: f64, min: Option<f64>, max: Option<f64>| {
        min.is_none_or(|m| value >= m) && max.is_none_or(|m| value <= m)
    };
    within(state.t_dp, limits.dp_min, limits.dp_max)
        && within(state.rh, limits.rh_min, limits.rh_max)
        && within(state.w, limits.w_min, limits.w_max)
}

/// The fogging check an automotive cabin needs: `t_dp,cabin ≥ t_glass,inner`.
///
/// `REQUIREMENTS.md` §10.2. Fog forms on the inside of the glass when the
/// cabin's dew point reaches the glass temperature, which is why a cabin model
/// needs a dew point rather than a relative humidity — the same 50% RH fogs at
/// one cabin temperature and not at another.
///
/// Returns the margin in kelvin: positive is clear, negative is fogging.
#[must_use]
pub fn fogging_margin(cabin: &StatePoint, t_glass_inner: f64) -> f64 {
    t_glass_inner - cabin.t_dp
}

/// A state's distance outside an envelope, per bound, for a compliance report.
#[derive(Debug, Clone, Copy, Default)]
pub struct Excursion {
    /// Kelvin outside the dry-bulb band; zero when inside.
    pub dry_bulb: f64,
    /// Kelvin outside the dew-point band.
    pub dew_point: f64,
    /// Percentage points outside the relative-humidity band.
    pub relative_humidity: f64,
}

/// How far outside an envelope a state sits, bound by bound.
///
/// "Outside the envelope" is not a useful answer on its own — a data centre two
/// kelvin over the recommended band is a different conversation from one twelve
/// kelvin over, and the bound that is violated says which mechanism is at risk.
#[must_use]
pub fn excursion(state: &StatePoint, limits: &Limits) -> Excursion {
    let over = |value: f64, min: Option<f64>, max: Option<f64>| {
        let below = min.map_or(0.0, |m| (m - value).max(0.0));
        let above = max.map_or(0.0, |m| (value - m).max(0.0));
        below.max(above)
    };
    Excursion {
        dry_bulb: over(state.t_db, Some(limits.t_min), Some(limits.t_max)),
        dew_point: over(state.t_dp, limits.dp_min, limits.dp_max),
        relative_humidity: over(state.rh, limits.rh_min, limits.rh_max) * 100.0,
    }
}
