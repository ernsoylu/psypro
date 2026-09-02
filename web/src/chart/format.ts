/**
 * How a property is written down.
 *
 * One table, used by the properties panel, the HUD tooltip and later the data
 * table, so the same quantity never appears with two different precisions in
 * two places. Nothing here computes anything — every value arrives already
 * resolved by the engine.
 *
 * The precisions are chosen from what the number is *for*, not from what looks
 * tidy. Humidity ratio gets six decimals because at 0.009 a third decimal is a
 * 10% error; enthalpy gets three because a coil load is the difference of two
 * enthalpies and rounding both first destroys the difference.
 */

import type { TranslationKey } from '../i18n';
import type { Translator } from '../i18n/useT';
import type { StatePointOutput } from '../psychro';

/** One formatted property. */
export interface FormattedProperty {
  /** Stable key, for React and for tests. */
  key: string;
  /** Translated name. */
  label: string;
  /** The defining ratio, where showing it prevents a conflation. */
  detail?: string;
  /** Formatted number. */
  value: string;
  /** Translated unit. */
  unit: string;
}

/** A temperature unit key for the active system. */
function tempUnit(isSi: boolean): TranslationKey {
  return isSi ? 'unit.celsius' : 'unit.fahrenheit';
}

/**
 * The full property list, in the order an engineer reads them.
 *
 * The three §3.2 distinctions are carried by this table rather than by whoever
 * renders it: relative humidity and degree of saturation are separate entries
 * with their defining ratios attached, wet-bulb says *thermodynamic*, specific
 * volume says *dry-air basis* and density says *reference only*.
 */
export function formatProperties(
  o: StatePointOutput,
  isSi: boolean,
  t: Translator,
): FormattedProperty[] {
  const temp = t(tempUnit(isSi));
  return [
    { key: 'dbt', label: t('prop.dryBulb'), value: o.dbt.toFixed(2), unit: temp },
    { key: 'wbt', label: t('prop.wetBulb'), value: o.wbt.toFixed(2), unit: temp },
    {
      key: 'dp',
      // Below freezing this is a frost point, over ice rather than water, and
      // saying so is the difference between a reading and a wrong reading.
      label: t(o.dew_point < 0 ? 'prop.frostPoint' : 'prop.dewPoint'),
      value: o.dew_point.toFixed(2),
      unit: temp,
    },
    {
      key: 'w',
      label: t('prop.humidityRatio'),
      value: o.humidity_ratio.toFixed(6),
      unit: t(isSi ? 'unit.kgPerKg' : 'unit.lbPerLb'),
    },
    {
      key: 'grains',
      label: t('prop.humidityRatio'),
      value: o.humidity_ratio_grains.toFixed(1),
      unit: t('unit.grainsPerLb'),
    },
    {
      key: 'rh',
      label: t('prop.relativeHumidity'),
      detail: t('prop.relativeHumidityFormula'),
      value: o.rh.toFixed(2),
      unit: t('unit.percent'),
    },
    {
      key: 'mu',
      label: t('prop.degreeOfSaturation'),
      detail: t('prop.degreeOfSaturationFormula'),
      value: o.degree_of_saturation.toFixed(2),
      unit: t('unit.percent'),
    },
    {
      key: 'h',
      label: t('prop.enthalpy'),
      value: o.enthalpy.toFixed(3),
      unit: t(isSi ? 'unit.kjPerKg' : 'unit.btuPerLb'),
    },
    {
      key: 'v',
      label: t('prop.specificVolume'),
      value: o.specific_volume.toFixed(5),
      unit: t(isSi ? 'unit.m3PerKg' : 'unit.ft3PerLb'),
    },
    {
      key: 'rho',
      label: t('prop.density'),
      value: o.density.toFixed(5),
      unit: t(isSi ? 'unit.kgPerM3' : 'unit.lbPerFt3'),
    },
    {
      key: 'pw',
      label: t('prop.vapourPressure'),
      value: o.vapor_pressure.toFixed(4),
      unit: t(isSi ? 'unit.kilopascal' : 'unit.psi'),
    },
    {
      key: 'p',
      label: t('prop.barometricPressure'),
      value: o.barometric_pressure.toFixed(4),
      unit: t(isSi ? 'unit.kilopascal' : 'unit.psi'),
    },
  ];
}

/**
 * What the HUD shows, and what it calls it.
 *
 * The *values* come from the same table as the panel, so the two can never
 * disagree about a number's precision — which they would within a week if each
 * formatted its own. The *names* are separate and short: a tooltip that follows
 * the pointer has about twelve characters of room, and
 * "Wet-bulb temperature (thermodynamic)" does not fit in them.
 *
 * The full name still carries the qualification, and that is where it belongs:
 * a reader consulting the panel is reading a value, and a reader watching the
 * HUD is sweeping the chart.
 */
const HUD_ROWS = [
  ['dbt', 'hud.dryBulb'],
  ['wbt', 'hud.wetBulb'],
  ['dp', 'hud.dewPoint'],
  ['w', 'hud.humidityRatio'],
  ['rh', 'hud.relativeHumidity'],
  ['h', 'hud.enthalpy'],
] as const satisfies readonly (readonly [string, TranslationKey])[];

/** The tooltip rows. */
export function formatHud(
  o: StatePointOutput,
  isSi: boolean,
  t: Translator,
): { label: string; value: string }[] {
  const all = new Map(formatProperties(o, isSi, t).map((p) => [p.key, p]));
  return HUD_ROWS.flatMap(([key, label]) => {
    const p = all.get(key);
    return p ? [{ label: t(label), value: `${p.value} ${p.unit}` }] : [];
  });
}
