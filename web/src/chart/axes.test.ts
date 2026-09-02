/**
 * Axis labelling, derived from the grid.
 *
 * The property under test is that a tick anchor is *a point on the curve it
 * labels*. A chart whose numerals were computed independently of its lines can
 * drift from them silently — the numbers keep looking plausible while pointing
 * at the wrong gridline — and it is the kind of error nobody catches by eye.
 */

import { describe, expect, it } from 'vitest';

import { ChartLayout, CurveFamilyId } from '../psychro';
import { chartLabels } from './axes';
import type { GridCurve } from './useBaseGrid';

/** A curve with the given family, value and vertices. */
function curve(family: CurveFamilyId, value: number, pts: number[]): GridCurve {
  return { family, value, coords: Float64Array.from(pts) };
}

const GRID: GridCurve[] = [
  curve(CurveFamilyId.DryBulb, 25, [25.5, 0, 25.9, 0.02]),
  curve(CurveFamilyId.DryBulb, 24, [24.4, 0, 24.8, 0.02]),
  curve(CurveFamilyId.HumidityRatio, 0.01, [12, 0.01, 52, 0.01]),
  curve(CurveFamilyId.HumidityRatio, 0.011, [13, 0.011, 52, 0.011]),
  curve(CurveFamilyId.RelativeHumidity, 0.5, [10, 0.004, 30, 0.011, 45, 0.03]),
  curve(CurveFamilyId.RelativeHumidity, 1, [0, 0.004, 20, 0.015, 30, 0.03]),
  curve(CurveFamilyId.Enthalpy, 50, [50, 0, 25, 0.01]),
  curve(CurveFamilyId.Enthalpy, 55, [55, 0, 30, 0.01]),
  curve(CurveFamilyId.WetBulb, 20, [40, 0, 20, 0.014]),
  curve(CurveFamilyId.SpecificVolume, 0.86, [30, 0, 20, 0.02]),
];

const labels = chartLabels(GRID, ChartLayout.Ashrae);

describe('chart labels', () => {
  it('anchors every label on a vertex of the curve it names', () => {
    for (const label of labels) {
      const named = GRID.find(
        (c) =>
          c.family === label.family &&
          `${label.key.split(':')[0]}:${c.value}` === label.key,
      );
      expect(named, `no curve matches ${label.key}`).toBeDefined();

      let onVertex = false;
      const coords = named!.coords;
      for (let i = 0; i < coords.length; i += 2) {
        if (coords[i] === label.x && coords[i + 1] === label.y) onVertex = true;
      }
      // Exactly on a vertex, never interpolated and never recomputed: a numeral
      // that drifts off its own gridline still looks plausible, which is what
      // makes that failure worth a test rather than an eye.
      expect(onVertex, `${label.key} is not on its own curve`).toBe(true);
    }
  });

  it('numbers only the major members of a crowded family', () => {
    // Every 5 °C and every 0.005 kg/kg. A numeral per gridline is unreadable
    // before it is informative.
    expect(labels.filter((l) => l.key.startsWith('t:')).map((l) => l.text)).toEqual([
      '25',
    ]);
    expect(labels.filter((l) => l.key.startsWith('w:')).map((l) => l.text)).toEqual([
      '0.010',
    ]);
  });

  it('does not number the saturation curve as a relative humidity', () => {
    const rh = labels.filter((l) => l.key.startsWith('rh:'));
    expect(rh.map((l) => l.text)).toEqual(['50%']);
    // 100% RH *is* saturation, and a chart labels it as the boundary, not as
    // one more member of the RH family.
    expect(rh.some((l) => l.text === '100%')).toBe(false);
  });

  it('leaves the shallow-crossing families unlabelled', () => {
    // Wet-bulb and specific volume scales belong on the saturation line, with
    // the protractor. Numbering them in the field is what makes a chart soup.
    expect(labels.some((l) => l.family === CurveFamilyId.WetBulb)).toBe(false);
    expect(labels.some((l) => l.family === CurveFamilyId.SpecificVolume)).toBe(false);
  });

  it('puts dry-bulb numerals at the driest end of their isotherms', () => {
    const t25 = labels.find((l) => l.key === 't:25');
    expect(t25?.y).toBe(0);
    // Below the axis, not on it.
    expect(t25?.dy).toBeGreaterThan(0);
  });

  it('puts humidity-ratio numerals at the warmest end of their lines', () => {
    const w = labels.find((l) => l.key === 'w:0.01');
    expect(w?.x).toBe(52);
    expect(w?.dx).toBeGreaterThan(0);
  });

  it('moves the numerals to the other axis for a Mollier chart', () => {
    const mollier = chartLabels(GRID, ChartLayout.MollierIx);
    const t25 = mollier.find((l) => l.key === 't:25');
    // The axes are exchanged, so the dry-bulb scale is now vertical: the
    // numeral is offset horizontally rather than vertically.
    expect(t25?.dx).toBeLessThan(0);
    expect(t25?.dy).toBe(0);
    expect(t25?.align).toBe('right');
  });

  it('produces a stable key per label, so React keeps the node across a pan', () => {
    const keys = labels.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(chartLabels(GRID, ChartLayout.Ashrae).map((l) => l.key)).toEqual(keys);
  });
});
