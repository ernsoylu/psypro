/**
 * The line-styling matrix, before it has a UI.
 *
 * These are the emphasis rules ASHRAE Chart No. 1 uses, and they carry
 * information rather than decoration — the saturation curve bounds the physical
 * region, and the decade isotherms are what a reader counts along. Asserting
 * them here means Phase 12's editable matrix has a defined starting point
 * rather than whatever the renderer happened to do.
 */

import { describe, expect, it } from 'vitest';

import { CurveFamilyId } from '../psychro';
import {
  DEFAULT_STYLES,
  TOGGLEABLE_FAMILIES,
  type FamilyStyle,
} from '../store/useStyleStore';
import { curveStyle, DASH_PATTERN, isMajor, isSaturation } from './style';
import type { ChartTokens } from './useChartTokens';

const TOKENS: ChartTokens = {
  family: {
    [CurveFamilyId.DryBulb]: 'db',
    [CurveFamilyId.HumidityRatio]: 'hr',
    [CurveFamilyId.RelativeHumidity]: 'rh',
    [CurveFamilyId.WetBulb]: 'wb',
    [CurveFamilyId.Enthalpy]: 'h',
    [CurveFamilyId.SpecificVolume]: 'v',
  },
  saturation: 'sat',
  axis: 'axis',
  text: 'text',
  background: 'bg',
  point: 'point',
  process: 'process',
  zoneComfort: 'zone-comfort',
  zoneDatacenter: 'zone-datacenter',
};

describe('curve styling', () => {
  it('recognises saturation as 100% relative humidity, not a family of its own', () => {
    expect(isSaturation(CurveFamilyId.RelativeHumidity, 1)).toBe(true);
    expect(isSaturation(CurveFamilyId.RelativeHumidity, 0.9)).toBe(false);
    expect(isSaturation(CurveFamilyId.WetBulb, 1)).toBe(false);
  });

  it('draws saturation heavier than everything else', () => {
    const sat = curveStyle(CurveFamilyId.RelativeHumidity, 1, TOKENS);
    expect(sat.stroke).toBe('sat');
    // It bounds the physical region: nothing exists above it, and a reader
    // needs to see where that boundary is without hunting for it.
    for (const family of Object.values(CurveFamilyId).filter(
      (f): f is CurveFamilyId => typeof f === 'number',
    )) {
      const other = curveStyle(family, 0.9, TOKENS);
      if (other.stroke === 'sat') continue;
      expect(sat.strokeWidth).toBeGreaterThan(other.strokeWidth);
    }
  });

  it('emphasises the decade lines a reader counts along', () => {
    expect(isMajor(CurveFamilyId.DryBulb, 25)).toBe(true);
    expect(isMajor(CurveFamilyId.DryBulb, 24)).toBe(false);
    expect(isMajor(CurveFamilyId.Enthalpy, 40)).toBe(true);
    expect(isMajor(CurveFamilyId.Enthalpy, 45)).toBe(false);
    // Floating-point accumulation over a 0.001 step must not turn a major
    // gridline minor: 0.015 arrives as 0.015000000000000001.
    expect(isMajor(CurveFamilyId.HumidityRatio, 0.005 * 3)).toBe(true);
  });

  it('gives a major line more weight than a minor one in the same family', () => {
    const major = curveStyle(CurveFamilyId.DryBulb, 25, TOKENS);
    const minor = curveStyle(CurveFamilyId.DryBulb, 24, TOKENS);
    expect(major.strokeWidth).toBeGreaterThan(minor.strokeWidth);
    expect(major.opacity).toBeGreaterThan(minor.opacity);
    expect(major.stroke).toBe(minor.stroke);
  });

  it('dashes the two families that cross the others at shallow angles', () => {
    expect(curveStyle(CurveFamilyId.WetBulb, 20, TOKENS).dash).toBeDefined();
    expect(curveStyle(CurveFamilyId.SpecificVolume, 0.86, TOKENS).dash).toBeDefined();
    expect(curveStyle(CurveFamilyId.DryBulb, 25, TOKENS).dash).toBeUndefined();
    expect(curveStyle(CurveFamilyId.Enthalpy, 40, TOKENS).dash).toBeUndefined();
  });

  it('takes every colour from a token, never from a literal', () => {
    const strokes = new Set(
      [
        curveStyle(CurveFamilyId.DryBulb, 25, TOKENS),
        curveStyle(CurveFamilyId.HumidityRatio, 0.01, TOKENS),
        curveStyle(CurveFamilyId.RelativeHumidity, 0.5, TOKENS),
        curveStyle(CurveFamilyId.RelativeHumidity, 1, TOKENS),
        curveStyle(CurveFamilyId.WetBulb, 20, TOKENS),
        curveStyle(CurveFamilyId.Enthalpy, 40, TOKENS),
        curveStyle(CurveFamilyId.SpecificVolume, 0.86, TOKENS),
      ].map((s) => s.stroke),
    );
    // Every stroke traces back to one of the supplied tokens, so re-theming the
    // chart is editing theme.css and nothing else.
    const fromTokens = [...Object.values(TOKENS.family), TOKENS.saturation];
    for (const s of strokes) expect(fromTokens).toContain(s);
    // ...and every family is actually distinguishable, rather than six curves
    // sharing one colour because a lookup silently fell through.
    expect(strokes.size).toBeGreaterThanOrEqual(6);
  });
});

describe('the styling matrix', () => {
  /** The defaults with one family patched, leaving the rest of the chart alone. */
  const withStyle = (
    family: CurveFamilyId,
    patch: Partial<FamilyStyle>,
  ): Record<CurveFamilyId, FamilyStyle> => ({
    ...DEFAULT_STYLES,
    [family]: { ...DEFAULT_STYLES[family], ...patch },
  });

  it('defines the three dash patterns of REQUIREMENTS §8', () => {
    expect(DASH_PATTERN.solid).toBeUndefined();
    expect(DASH_PATTERN.dotted).toEqual([1, 3]);
    expect(DASH_PATTERN.dashed).toEqual([5, 4]);
  });

  it('overrides the theme colour for one family only', () => {
    const styles = withStyle(CurveFamilyId.WetBulb, { color: '#123456' });
    expect(curveStyle(CurveFamilyId.WetBulb, 20, TOKENS, styles).stroke).toBe('#123456');
    // The rest of the chart keeps its theme colours.
    expect(curveStyle(CurveFamilyId.DryBulb, 25, TOKENS, styles).stroke).toBe('db');
    expect(curveStyle(CurveFamilyId.Enthalpy, 40, TOKENS, styles).stroke).toBe('h');
  });

  it('dots a family when the reader asks for dots', () => {
    const styles = withStyle(CurveFamilyId.DryBulb, { lineStyle: 'dotted' });
    expect(curveStyle(CurveFamilyId.DryBulb, 25, TOKENS, styles).dash).toEqual([1, 3]);
  });

  it('lets solid remove the dash from a historically dashed family', () => {
    const styles = withStyle(CurveFamilyId.SpecificVolume, { lineStyle: 'solid' });
    expect(
      curveStyle(CurveFamilyId.SpecificVolume, 0.86, TOKENS, styles).dash,
    ).toBeUndefined();
  });

  it('scales the minor width from the family width at the fixed ratio', () => {
    const styles = withStyle(CurveFamilyId.DryBulb, { width: 2 });
    expect(curveStyle(CurveFamilyId.DryBulb, 25, TOKENS, styles).strokeWidth).toBe(2);
    // 2 × 0.7, rounded the way the drawing pipeline rounds.
    expect(curveStyle(CurveFamilyId.DryBulb, 24, TOKENS, styles).strokeWidth).toBe(1.4);
  });

  it('gives saturation the RH colour override but keeps its own solid weight', () => {
    const styles = withStyle(CurveFamilyId.RelativeHumidity, {
      color: '#aa0000',
      lineStyle: 'dotted',
      width: 4,
    });
    const sat = curveStyle(CurveFamilyId.RelativeHumidity, 1, TOKENS, styles);
    expect(sat.stroke).toBe('#aa0000');
    expect(sat.strokeWidth).toBe(2);
    expect(sat.opacity).toBe(1);
    expect(sat.dash).toBeUndefined();
    // A plain RH curve takes the whole override, dash and width included.
    const rh = curveStyle(CurveFamilyId.RelativeHumidity, 0.5, TOKENS, styles);
    expect(rh.stroke).toBe('#aa0000');
    expect(rh.strokeWidth).toBe(4);
    expect(rh.dash).toEqual([1, 3]);
  });

  it('draws exactly as the defaults say when no matrix is passed', () => {
    for (const family of TOGGLEABLE_FAMILIES) {
      expect(curveStyle(family, 0.5, TOKENS)).toEqual(
        curveStyle(family, 0.5, TOKENS, DEFAULT_STYLES),
      );
    }
  });
});
