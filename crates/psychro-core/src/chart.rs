//! Physical properties → chart space.
//!
//! This is the first of the two coordinate stages. It maps thermodynamic state
//! onto the oblique axes of a psychrometric chart, and is deliberately free of
//! pixels, zoom and pan — those belong to the view layer, which consumes the
//! output of this module. Keeping the split means a chart layout can change
//! without touching the renderer, and the renderer can change without risking
//! the geometry.
//!
//! # The oblique construction
//!
//! A psychrometric chart is not a plot of `W` against `t_db`. It is an
//! oblique-angle chart whose real coordinates are enthalpy and humidity ratio,
//! chosen so that lines of constant enthalpy come out straight and parallel.
//!
//! Define the **reduced sensible coordinate**
//!
//! ```text
//! σ = h − h_g,ref · W = t_db · (c_p,da + c_p,wv · W)
//! ```
//!
//! Two properties follow directly, and they are what make the chart work:
//!
//! * **Constant enthalpy** — `σ = h − h_g,ref·W` is linear in `W` with slope
//!   `−h_g,ref` for every `h`. Straight, and parallel to each other.
//! * **Constant dry-bulb** — `σ = t·(c_p,da + c_p,wv·W)` is linear in `W` with
//!   slope `c_p,wv·t`. Straight, but *not* parallel: the isotherms fan out as
//!   `t` rises. That divergence is the visible skew of a real ASHRAE chart, and
//!   it falls out of the thermodynamics rather than being applied as a cosmetic
//!   shear.
//!
//! The ASHRAE and Mollier i-x layouts are the same reduced space with the axes
//! exchanged, so both are exact and neither is a special case of the other.
//!
//! Because both families are straight in this space, a renderer needs only two
//! endpoints per enthalpy or dry-bulb line rather than a sampled polyline.

use crate::constants::{CP_DA, CP_WV, H_G_REF};
use crate::saturation::p_ws;
use crate::state::{
    humidity_ratio_from_p_wv, humidity_ratio_from_wet_bulb, saturation_humidity_ratio, Atmosphere,
};

/// Which chart layout the coordinates are expressed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChartLayout {
    /// ASHRAE format: reduced sensible coordinate horizontal, humidity ratio vertical.
    Ashrae,
    /// Mollier i-x diagram: humidity ratio horizontal, reduced sensible coordinate vertical.
    ///
    /// The 0 °C isotherm is horizontal at `y = 0`, which is the defining feature
    /// of the layout.
    MollierIx,
}

/// A point in chart space.
///
/// Units are those of the reduced coordinate (kJ/kg_da) on one axis and humidity
/// ratio (kg/kg_da) on the other; which is which depends on the layout. The view
/// layer scales these to pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChartPoint {
    /// Horizontal chart coordinate.
    pub x: f64,
    /// Vertical chart coordinate.
    pub y: f64,
}

/// An axis-aligned region of chart space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChartBounds {
    /// Minimum horizontal coordinate.
    pub x_min: f64,
    /// Maximum horizontal coordinate.
    pub x_max: f64,
    /// Minimum vertical coordinate.
    pub y_min: f64,
    /// Maximum vertical coordinate.
    pub y_max: f64,
}

/// The physical extent a chart is drawn over.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChartDomain {
    /// Lowest dry-bulb temperature shown, °C.
    pub t_min: f64,
    /// Highest dry-bulb temperature shown, °C.
    pub t_max: f64,
    /// Lowest humidity ratio shown, kg/kg_da.
    pub w_min: f64,
    /// Highest humidity ratio shown, kg/kg_da.
    pub w_max: f64,
}

impl Default for ChartDomain {
    fn default() -> Self {
        Self {
            t_min: -10.0,
            t_max: 50.0,
            w_min: 0.0,
            w_max: 0.030,
        }
    }
}

/// The reduced sensible coordinate `σ = h − h_g,ref·W = t·(c_p,da + c_p,wv·W)`.
#[must_use]
pub fn reduced_coordinate(t_db: f64, w: f64) -> f64 {
    t_db * (CP_DA + CP_WV * w)
}

/// Recovers dry-bulb temperature from the reduced coordinate and humidity ratio.
///
/// Exact inverse of [`reduced_coordinate`]; the denominator is bounded below by
/// `c_p,da` for any physical `W ≥ 0`, so this cannot divide by zero.
#[must_use]
pub fn temperature_from_reduced(sigma: f64, w: f64) -> f64 {
    sigma / (CP_DA + CP_WV * w)
}

/// Maps a state's dry-bulb temperature and humidity ratio into chart space.
#[must_use]
pub fn to_chart(t_db: f64, w: f64, layout: ChartLayout) -> ChartPoint {
    let sigma = reduced_coordinate(t_db, w);
    match layout {
        ChartLayout::Ashrae => ChartPoint { x: sigma, y: w },
        ChartLayout::MollierIx => ChartPoint { x: w, y: sigma },
    }
}

/// Recovers dry-bulb temperature and humidity ratio from a chart-space point.
///
/// Exact inverse of [`to_chart`]. This is the path a pointer drag takes: screen
/// coordinates become chart coordinates in the view layer, then properties here.
#[must_use]
pub fn from_chart(point: ChartPoint, layout: ChartLayout) -> (f64, f64) {
    let (sigma, w) = match layout {
        ChartLayout::Ashrae => (point.x, point.y),
        ChartLayout::MollierIx => (point.y, point.x),
    };
    (temperature_from_reduced(sigma, w), w)
}

/// The chart-space bounds of a physical domain.
///
/// The reduced coordinate depends on `W` as well as `t`, so the extremes are
/// taken over the domain's corners rather than assumed to lie at the temperature
/// limits.
#[must_use]
pub fn bounds(domain: &ChartDomain, layout: ChartLayout) -> ChartBounds {
    let corners = [
        (domain.t_min, domain.w_min),
        (domain.t_min, domain.w_max),
        (domain.t_max, domain.w_min),
        (domain.t_max, domain.w_max),
    ];
    let mut b = ChartBounds {
        x_min: f64::INFINITY,
        x_max: f64::NEG_INFINITY,
        y_min: f64::INFINITY,
        y_max: f64::NEG_INFINITY,
    };
    for (t, w) in corners {
        let p = to_chart(t, w, layout);
        b.x_min = b.x_min.min(p.x);
        b.x_max = b.x_max.max(p.x);
        b.y_min = b.y_min.min(p.y);
        b.y_max = b.y_max.max(p.y);
    }
    b
}

/// Which family a generated curve belongs to.
///
/// The renderer styles by family, so this is the key into the line-styling
/// matrix and, in turn, into the CSS variables.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CurveFamily {
    /// Constant dry-bulb temperature. Straight in chart space.
    DryBulb,
    /// Constant humidity ratio. Straight in chart space.
    HumidityRatio,
    /// Constant relative humidity, including the saturation curve at 100%.
    RelativeHumidity,
    /// Constant thermodynamic wet-bulb temperature.
    WetBulb,
    /// Constant enthalpy. Straight and parallel in chart space.
    Enthalpy,
    /// Constant specific volume.
    SpecificVolume,
}

impl CurveFamily {
    /// Whether members of this family are straight lines in chart space.
    ///
    /// Straight families need only their two endpoints, which is why a full grid
    /// costs far less than sampling every curve.
    #[must_use]
    pub const fn is_straight_in_chart_space(self) -> bool {
        matches!(self, Self::DryBulb | Self::HumidityRatio | Self::Enthalpy)
    }
}

/// One generated constant-property curve.
#[derive(Debug, Clone, PartialEq)]
pub struct Curve {
    /// The family this curve belongs to.
    pub family: CurveFamily,
    /// The constant value defining it, in that family's natural units.
    pub value: f64,
    /// The polyline, in chart space. Two points when the family is straight.
    pub points: Vec<ChartPoint>,
}

/// Sample count used for curved families across the domain.
const SAMPLES: usize = 96;

/// Appends a sampled curve, dropping any that clipping reduced below two points.
///
/// A family member can fall entirely outside the domain — a specific-volume line
/// off the low-temperature end, or a wet-bulb line that only meets the domain
/// above saturation. Emitting a zero- or one-point curve would hand the renderer
/// something it cannot draw, so it is dropped here rather than guarded downstream.
fn push_sampled(out: &mut Vec<Curve>, family: CurveFamily, value: f64, points: Vec<ChartPoint>) {
    if points.len() >= 2 {
        out.push(Curve {
            family,
            value,
            points,
        });
    }
}

/// Generates every constant-property curve for a domain, ready to render.
///
/// Curves are clipped to the domain and to the saturation line, since states
/// above saturation are not moist air. Straight families emit two points.
#[must_use]
pub fn generate_grid(
    domain: &ChartDomain,
    layout: ChartLayout,
    atm: &Atmosphere,
    spec: &GridSpec,
) -> Vec<Curve> {
    let mut out = Vec::with_capacity(64);
    let w_cap = |t: f64| saturation_humidity_ratio(t, atm).min(domain.w_max);

    // Constant dry-bulb: straight, from the axis up to saturation.
    for t in spec.dry_bulb.iter().copied() {
        if t < domain.t_min || t > domain.t_max {
            continue;
        }
        let top = w_cap(t).max(domain.w_min);
        out.push(Curve {
            family: CurveFamily::DryBulb,
            value: t,
            points: vec![to_chart(t, domain.w_min, layout), to_chart(t, top, layout)],
        });
    }

    // Constant humidity ratio: straight, from the saturation line rightwards.
    for w in spec.humidity_ratio.iter().copied() {
        if w < domain.w_min || w > domain.w_max {
            continue;
        }
        let t_start = saturation_temperature_for(w, atm, domain).unwrap_or(domain.t_min);
        out.push(Curve {
            family: CurveFamily::HumidityRatio,
            value: w,
            points: vec![
                to_chart(t_start, w, layout),
                to_chart(domain.t_max, w, layout),
            ],
        });
    }

    // Constant enthalpy: straight and parallel.
    for h in spec.enthalpy.iter().copied() {
        if let Some(pts) = enthalpy_segment(h, domain, atm, layout) {
            out.push(Curve {
                family: CurveFamily::Enthalpy,
                value: h,
                points: pts,
            });
        }
    }

    // Curved families, sampled.
    for rh in spec.relative_humidity.iter().copied() {
        let pts = sample(domain, layout, atm, |t| {
            humidity_ratio_from_p_wv(rh * p_ws(t), atm)
        });
        push_sampled(&mut out, CurveFamily::RelativeHumidity, rh, pts);
    }
    for t_wb in spec.wet_bulb.iter().copied() {
        let pts = sample(domain, layout, atm, |t| {
            humidity_ratio_from_wet_bulb(t, t_wb, atm)
        });
        push_sampled(&mut out, CurveFamily::WetBulb, t_wb, pts);
    }
    for v in spec.specific_volume.iter().copied() {
        let pts = sample(domain, layout, atm, |t| {
            (v * atm.p_bar / (crate::constants::R_DA * (t + 273.15)) - 1.0)
                / crate::constants::MASS_RATIO_INV
        });
        push_sampled(&mut out, CurveFamily::SpecificVolume, v, pts);
    }
    out
}

/// Samples a curve `W(t)` across the domain, clipping to the bounds and to the
/// saturation line.
///
/// The saturation clip is not cosmetic. A constant-wet-bulb relation evaluated
/// at `t_db < t_wb` is unphysical and returns a humidity ratio above saturation;
/// without this guard those points would be drawn as if they were real states.
/// Clipping here covers every sampled family at once rather than special-casing
/// each one.
fn sample(
    domain: &ChartDomain,
    layout: ChartLayout,
    atm: &Atmosphere,
    f: impl Fn(f64) -> f64,
) -> Vec<ChartPoint> {
    let mut pts = Vec::with_capacity(SAMPLES);
    let step = (domain.t_max - domain.t_min) / (SAMPLES - 1) as f64;
    for i in 0..SAMPLES {
        let t = domain.t_min + step * i as f64;
        let w = f(t);
        if !w.is_finite() || w < domain.w_min || w > domain.w_max {
            continue;
        }
        // Allow the saturation curve itself, reject anything genuinely above it.
        if w > saturation_humidity_ratio(t, atm) * (1.0 + 1e-9) {
            continue;
        }
        pts.push(to_chart(t, w, layout));
    }
    pts
}

/// The temperature at which saturation reaches `w`, if inside the domain.
fn saturation_temperature_for(w: f64, atm: &Atmosphere, domain: &ChartDomain) -> Option<f64> {
    let (mut lo, mut hi) = (domain.t_min, domain.t_max);
    if saturation_humidity_ratio(hi, atm) < w {
        return None;
    }
    for _ in 0..80 {
        let mid = 0.5 * (lo + hi);
        if saturation_humidity_ratio(mid, atm) < w {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    Some(0.5 * (lo + hi))
}

/// Endpoints of a constant-enthalpy line, clipped to the domain and saturation.
fn enthalpy_segment(
    h: f64,
    domain: &ChartDomain,
    atm: &Atmosphere,
    layout: ChartLayout,
) -> Option<Vec<ChartPoint>> {
    // W along the line, as a function of t.
    let w_of = |t: f64| (h - CP_DA * t) / (H_G_REF + CP_WV * t);
    // Walk in from the warm end to the first point at or above saturation.
    let steps = 240;
    let step = (domain.t_max - domain.t_min) / steps as f64;
    let mut first: Option<(f64, f64)> = None;
    let mut last: Option<(f64, f64)> = None;
    for i in 0..=steps {
        let t = domain.t_max - step * i as f64;
        let w = w_of(t);
        if !w.is_finite() || w < domain.w_min || w > domain.w_max {
            continue;
        }
        if w > saturation_humidity_ratio(t, atm) {
            break;
        }
        if last.is_none() {
            last = Some((t, w));
        }
        first = Some((t, w));
    }
    match (first, last) {
        (Some(a), Some(b)) if (a.0 - b.0).abs() > f64::EPSILON => {
            Some(vec![to_chart(a.0, a.1, layout), to_chart(b.0, b.1, layout)])
        }
        _ => None,
    }
}

/// Which constant values to draw for each family.
#[derive(Debug, Clone, PartialEq)]
pub struct GridSpec {
    /// Dry-bulb temperatures, °C.
    pub dry_bulb: Vec<f64>,
    /// Humidity ratios, kg/kg_da.
    pub humidity_ratio: Vec<f64>,
    /// Relative humidities as fractions, 0 to 1. Include 1.0 for saturation.
    pub relative_humidity: Vec<f64>,
    /// Thermodynamic wet-bulb temperatures, °C.
    pub wet_bulb: Vec<f64>,
    /// Enthalpies, kJ/kg_da.
    pub enthalpy: Vec<f64>,
    /// Specific volumes, m³/kg_da.
    pub specific_volume: Vec<f64>,
}

impl Default for GridSpec {
    /// The default ASHRAE Chart No. 1 style intervals over a comfort-range domain.
    fn default() -> Self {
        Self {
            dry_bulb: range(-10.0, 50.0, 1.0),
            humidity_ratio: range(0.0, 0.030, 0.001),
            relative_humidity: {
                let mut v = range(0.1, 0.9, 0.1);
                v.push(1.0);
                v
            },
            wet_bulb: range(-10.0, 30.0, 2.0),
            enthalpy: range(0.0, 120.0, 5.0),
            specific_volume: range(0.74, 0.96, 0.02),
        }
    }
}

/// Inclusive range as a vector, tolerant of floating-point step accumulation.
fn range(from: f64, to: f64, step: f64) -> Vec<f64> {
    let n = ((to - from) / step).round() as i64;
    (0..=n).map(|i| from + step * i as f64).collect()
}
