/**
 * The property formatting table.
 *
 * One table serves the panel, the HUD and later the data table, so the same
 * quantity can never appear with two precisions in two places — a failure that
 * looks like a rounding disagreement and reads like a calculation error.
 *
 * The precisions are chosen from what the numbers are *for*, and that is what
 * is asserted: six decimals on humidity ratio because at 0.009 a third decimal
 * is a 10% error, three on enthalpy because a coil load is the difference of
 * two enthalpies and rounding both first destroys the difference.
 */

import { describe, expect, it } from 'vitest';

import { formatHud, formatProperties } from './format';
import type { TranslationKey } from '../i18n';
import type { StatePointOutput } from '../psychro';

/** Identity translator: the key is the label, so labels are checkable. */
const t = (key: TranslationKey) => key as string;

const STATE = {
  dbt: 24,
  wbt: 17.0712,
  dew_point: 12.9876,
  humidity_ratio: 0.0093401,
  humidity_ratio_grains: 65.38,
  rh: 50.004,
  degree_of_saturation: 49.2512,
  enthalpy: 47.9087,
  specific_volume: 0.854112,
  density: 1.181742,
  vapor_pressure: 1.49213,
  barometric_pressure: 101.325,
  is_sub_freezing: false,
} as unknown as StatePointOutput;

const rows = formatProperties(STATE, true, t);
const byKey = new Map(rows.map((r) => [r.key, r]));

describe('property formatting', () => {
  it('keeps enough humidity-ratio precision to be a humidity ratio', () => {
    // Three decimals would make 0.009340 into 0.009: a 4% error on the number
    // every latent load in the document is computed from.
    expect(byKey.get('w')?.value).toBe('0.009340');
  });

  it('keeps enough enthalpy precision to survive a subtraction', () => {
    // A coil load is h_ent − h_lvg. Round each to a whole number first and a
    // 20 kJ/kg difference carries a full unit of error.
    expect(byKey.get('h')?.value).toBe('47.909');
  });

  it('reports relative humidity and degree of saturation as separate rows', () => {
    // They agree only at 0% and 100%. This state has them 0.75 points apart,
    // which is the whole reason both are shown.
    expect(byKey.get('rh')?.value).toBe('50.00');
    expect(byKey.get('mu')?.value).toBe('49.25');
    expect(byKey.get('rh')?.detail).toBe('prop.relativeHumidityFormula');
    expect(byKey.get('mu')?.detail).toBe('prop.degreeOfSaturationFormula');
  });

  it('qualifies the three properties that are routinely misread', () => {
    expect(byKey.get('wbt')?.label).toBe('prop.wetBulb');
    expect(byKey.get('v')?.label).toBe('prop.specificVolume');
    expect(byKey.get('rho')?.label).toBe('prop.density');
  });

  it('calls a sub-zero dew point a frost point', () => {
    // Below freezing the saturation line is over ice, not water. Calling it a
    // dew point is not a wording preference: it names the wrong phase.
    const cold = formatProperties(
      { ...STATE, dew_point: -8.4 } as StatePointOutput,
      true,
      t,
    );
    expect(cold.find((r) => r.key === 'dp')?.label).toBe('prop.frostPoint');
    expect(byKey.get('dp')?.label).toBe('prop.dewPoint');
  });

  it('switches every unit with the unit system, and only the units', () => {
    const ip = new Map(formatProperties(STATE, false, t).map((r) => [r.key, r]));
    expect(ip.get('dbt')?.unit).toBe('unit.fahrenheit');
    expect(ip.get('h')?.unit).toBe('unit.btuPerLb');
    expect(ip.get('v')?.unit).toBe('unit.ft3PerLb');
    // The engine has already converted the numbers; this table only labels
    // them, so a value must not change here.
    expect(ip.get('dbt')?.value).toBe(byKey.get('dbt')?.value);
    // Grains are an IP presentation of humidity ratio and stay grains in both.
    expect(ip.get('grains')?.unit).toBe('unit.grainsPerLb');
  });
});

describe('HUD formatting', () => {
  const hud = formatHud(STATE, true, t);

  it('shows the six properties a reader sweeps the chart for', () => {
    expect(hud.map((r) => r.label)).toEqual([
      'hud.dryBulb',
      'hud.wetBulb',
      'hud.dewPoint',
      'hud.humidityRatio',
      'hud.relativeHumidity',
      'hud.enthalpy',
    ]);
  });

  it('takes its numbers from the same table as the panel', () => {
    // Not a stylistic preference: two formatters drift, and a tooltip that
    // disagrees with the panel beside it reads as a calculation bug.
    for (const row of hud) {
      const panel = rows.find((r) => row.value.startsWith(r.value));
      expect(panel, `${row.label} = ${row.value} matches no panel row`).toBeDefined();
    }
  });

  it('uses short names, because a tooltip has no room for long ones', () => {
    // The panel says "Wet-bulb temperature (thermodynamic)". At the HUD's width
    // that overruns its own value, which is what this replaced.
    for (const row of hud) expect(row.label.length).toBeLessThan(24);
  });
});
