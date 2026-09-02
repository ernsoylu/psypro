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
import { curveStyle, isMajor, isSaturation } from './style';
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
