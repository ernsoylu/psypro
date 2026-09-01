//! Moist-air state points: the properties, and the conversions between them.
//!
//! Every quantity is on a **dry-air basis** (per kg of dry air). Dry-air mass is
//! what is conserved through heating, cooling, humidification and
//! dehumidification, so it is the only correct basis for mass and energy
//! balances. Moist-air density is reported for reference but must not be used to
//! derive mass flow.

use crate::constants::{
    CP_DA, CP_ICE, CP_LIQUID, CP_WV, H_G_REF, H_G_REF_ICE, MASS_RATIO, MASS_RATIO_INV, P_STD, R_DA,
};
use crate::saturation::{enhancement_factor, p_ws, t_sat};

/// The ambient conditions every calculation is resolved against.
///
/// Barometric pressure and the real-gas treatment are explicit inputs rather
/// than ambient state, so the engine stays stateless and a result can always be
/// reproduced from its inputs alone.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Atmosphere {
    /// Barometric pressure, Pa.
    pub p_bar: f64,
    /// Apply the water-vapour enhancement factor.
    ///
    /// ASHRAE's published psychrometric tables are real-gas, so this must be on
    /// to reproduce them. Turning it off gives the ideal-gas treatment found in
    /// introductory textbooks, which is useful for teaching but biases humidity
    /// ratio low by roughly half a percent.
    pub real_gas: bool,
}

impl Default for Atmosphere {
    fn default() -> Self {
        Self::sea_level()
    }
}

impl Atmosphere {
    /// Standard sea-level atmosphere with the real-gas treatment applied.
    #[must_use]
    pub const fn sea_level() -> Self {
        Self {
            p_bar: P_STD,
            real_gas: true,
        }
    }

    /// Real-gas atmosphere at an explicit barometric pressure, Pa.
    #[must_use]
    pub const fn at_pressure(p_bar: f64) -> Self {
        Self {
            p_bar,
            real_gas: true,
        }
    }

    /// Real-gas atmosphere at an elevation in metres, via the ICAO standard atmosphere.
    #[must_use]
    pub fn at_altitude(altitude_m: f64) -> Self {
        Self::at_pressure(pressure_from_altitude(altitude_m))
    }

    /// Ideal-gas atmosphere, ignoring the enhancement factor.
    #[must_use]
    pub const fn ideal(p_bar: f64) -> Self {
        Self {
            p_bar,
            real_gas: false,
        }
    }

    /// The enhancement factor in force, or exactly 1 under the ideal-gas treatment.
    #[must_use]
    pub fn f_s(&self) -> f64 {
        if self.real_gas {
            enhancement_factor(self.p_bar)
        } else {
            1.0
        }
    }
}

/// Humidity ratio `W` from water-vapour partial pressure, kg_wv/kg_da.
///
/// Applies the enhancement factor when the atmosphere is real-gas:
/// `W = 0.621945 · f_s · p_wv / (p_bar − f_s · p_wv)`.
#[must_use]
pub fn humidity_ratio_from_p_wv(p_wv: f64, atm: &Atmosphere) -> f64 {
    let p = atm.f_s() * p_wv;
    MASS_RATIO * p / (atm.p_bar - p)
}

/// Water-vapour partial pressure from humidity ratio, Pa. Inverse of
/// [`humidity_ratio_from_p_wv`].
#[must_use]
pub fn p_wv_from_humidity_ratio(w: f64, atm: &Atmosphere) -> f64 {
    w * atm.p_bar / (MASS_RATIO + w) / atm.f_s()
}

/// Saturation humidity ratio at `t_c`, kg_wv/kg_da.
#[must_use]
pub fn saturation_humidity_ratio(t_c: f64, atm: &Atmosphere) -> f64 {
    humidity_ratio_from_p_wv(p_ws(t_c), atm)
}

/// Moist-air specific enthalpy, kJ/kg_da.
///
/// `h = 1.006·t + W·(2499.86 + 1.84·t)`, using the ASHRAE RP-1485 water-vapour
/// reference enthalpy and specific heat.
#[must_use]
pub fn enthalpy(t_c: f64, w: f64) -> f64 {
    CP_DA * t_c + w * (H_G_REF + CP_WV * t_c)
}

/// Dry-bulb temperature recovered from enthalpy and humidity ratio, °C.
#[must_use]
pub fn temperature_from_enthalpy(h: f64, w: f64) -> f64 {
    (h - w * H_G_REF) / (CP_DA + CP_WV * w)
}

/// Specific volume per kg of dry air, m³/kg_da.
#[must_use]
pub fn specific_volume(t_c: f64, w: f64, atm: &Atmosphere) -> f64 {
    R_DA * (t_c + 273.15) * (1.0 + MASS_RATIO_INV * w) / atm.p_bar
}

/// Moist-air density, kg/m³.
///
/// Reported for reference only. Mass balances must use
/// `mass_flow = V̇ / specific_volume`, never `V̇ · density` — dry-air mass is
/// what is conserved across a process, and the two differ by about 1%.
#[must_use]
pub fn density(t_c: f64, w: f64, atm: &Atmosphere) -> f64 {
    (1.0 + w) / specific_volume(t_c, w, atm)
}

/// Dry-air mass flow rate from a volumetric flow rate, kg_da/s.
///
/// This is the only correct route from volume flow to mass flow for a
/// psychrometric balance.
#[must_use]
pub fn dry_air_mass_flow(volume_flow: f64, t_c: f64, w: f64, atm: &Atmosphere) -> f64 {
    volume_flow / specific_volume(t_c, w, atm)
}

/// Relative humidity as a fraction, `p_wv / p_ws`.
///
/// The partial-pressure ratio. It is *not* `W / W_s` — see
/// [`degree_of_saturation`].
#[must_use]
pub fn relative_humidity(t_c: f64, w: f64, atm: &Atmosphere) -> f64 {
    p_wv_from_humidity_ratio(w, atm) / p_ws(t_c)
}

/// Degree of saturation `μ = W / W_s`, as a fraction.
///
/// Frequently mislabelled as relative humidity. The two agree only at 0% and
/// 100%; near mid-range they differ by around a percentage point, so a tool that
/// conflates them silently reports the wrong number.
#[must_use]
pub fn degree_of_saturation(t_c: f64, w: f64, atm: &Atmosphere) -> f64 {
    w / saturation_humidity_ratio(t_c, atm)
}

/// Humidity ratio of moist air with the given dry-bulb and thermodynamic
/// wet-bulb temperatures.
///
/// Uses the liquid-water branch at and above 0 °C and the ice branch below it;
/// the two carry different reference enthalpies and specific heats.
#[must_use]
pub fn humidity_ratio_from_wet_bulb(t_db: f64, t_wb: f64, atm: &Atmosphere) -> f64 {
    let w_s = saturation_humidity_ratio(t_wb, atm);
    if t_wb >= 0.0 {
        let d_cp = CP_LIQUID - CP_WV;
        ((H_G_REF - d_cp * t_wb) * w_s - CP_DA * (t_db - t_wb))
            / (H_G_REF + CP_WV * t_db - CP_LIQUID * t_wb)
    } else {
        let d_cp = CP_ICE - (CP_LIQUID - CP_WV);
        ((H_G_REF_ICE - d_cp * t_wb) * w_s - CP_DA * (t_db - t_wb))
            / (H_G_REF_ICE + CP_WV * t_db - CP_ICE * t_wb)
    }
}

/// Thermodynamic wet-bulb temperature, °C.
///
/// Solved by bisection on [`humidity_ratio_from_wet_bulb`], which is monotonic
/// in `t_wb`. This is the *thermodynamic* wet-bulb defined by adiabatic
/// saturation, not the reading of a psychrometer: the two agree within about 1%
/// for air and water only at 3–5 m/s aspiration, and not at all for other
/// gas-vapour systems.
#[must_use]
pub fn wet_bulb(t_db: f64, w: f64, atm: &Atmosphere) -> f64 {
    let (mut lo, mut hi) = (-100.0_f64, t_db);
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        if humidity_ratio_from_wet_bulb(t_db, mid, atm) > w {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    0.5 * (lo + hi)
}

/// Dew-point temperature, °C — the frost point when it falls below 0 °C.
///
/// Returns `None` when the humidity ratio is non-positive or the resulting
/// vapour pressure falls outside the saturation curve's bracket.
#[must_use]
pub fn dew_point(w: f64, atm: &Atmosphere) -> Option<f64> {
    if w <= 0.0 {
        return None;
    }
    t_sat(p_wv_from_humidity_ratio(w, atm))
}

/// Barometric pressure from altitude, Pa, per the ICAO standard atmosphere.
///
/// Altitude is a first-class input: at 1600 m the humidity ratio for a given
/// temperature and relative humidity is around 20% higher than at sea level, so
/// a sea-level-only tool misreports every high-altitude design.
#[must_use]
pub fn pressure_from_altitude(altitude_m: f64) -> f64 {
    P_STD * (1.0 - 2.255_77e-5 * altitude_m).powf(5.2559)
}

/// A fully resolved moist-air state point.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StatePoint {
    /// Dry-bulb temperature, °C.
    pub t_db: f64,
    /// Thermodynamic wet-bulb temperature, °C.
    pub t_wb: f64,
    /// Dew-point (or frost-point) temperature, °C.
    pub t_dp: f64,
    /// Humidity ratio, kg_wv/kg_da.
    pub w: f64,
    /// Relative humidity, fraction `p_wv / p_ws`.
    pub rh: f64,
    /// Degree of saturation, fraction `W / W_s`.
    pub mu: f64,
    /// Specific enthalpy, kJ/kg_da.
    pub h: f64,
    /// Specific volume, m³/kg_da.
    pub v: f64,
    /// Moist-air density, kg/m³.
    pub rho: f64,
    /// Water-vapour partial pressure, Pa.
    pub p_wv: f64,
    /// The atmosphere this state was resolved against.
    pub atm: Atmosphere,
}

impl StatePoint {
    /// Resolves every property from dry-bulb temperature and humidity ratio.
    #[must_use]
    pub fn from_db_w(t_db: f64, w: f64, atm: &Atmosphere) -> Self {
        Self {
            t_db,
            t_wb: wet_bulb(t_db, w, atm),
            t_dp: dew_point(w, atm).unwrap_or(f64::NEG_INFINITY),
            w,
            rh: relative_humidity(t_db, w, atm),
            mu: degree_of_saturation(t_db, w, atm),
            h: enthalpy(t_db, w),
            v: specific_volume(t_db, w, atm),
            rho: density(t_db, w, atm),
            p_wv: p_wv_from_humidity_ratio(w, atm),
            atm: *atm,
        }
    }

    /// Resolves a state from dry-bulb temperature and relative humidity fraction.
    #[must_use]
    pub fn from_db_rh(t_db: f64, rh: f64, atm: &Atmosphere) -> Self {
        Self::from_db_w(t_db, humidity_ratio_from_p_wv(rh * p_ws(t_db), atm), atm)
    }

    /// Resolves a state from dry-bulb and thermodynamic wet-bulb temperatures.
    #[must_use]
    pub fn from_db_wb(t_db: f64, t_wb: f64, atm: &Atmosphere) -> Self {
        Self::from_db_w(t_db, humidity_ratio_from_wet_bulb(t_db, t_wb, atm), atm)
    }

    /// Resolves a state from dry-bulb temperature and dew point.
    #[must_use]
    pub fn from_db_dp(t_db: f64, t_dp: f64, atm: &Atmosphere) -> Self {
        Self::from_db_w(t_db, humidity_ratio_from_p_wv(p_ws(t_dp), atm), atm)
    }

    /// Resolves a state from enthalpy and humidity ratio.
    #[must_use]
    pub fn from_h_w(h: f64, w: f64, atm: &Atmosphere) -> Self {
        Self::from_db_w(temperature_from_enthalpy(h, w), w, atm)
    }
}
