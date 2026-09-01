/**
 * How a curve is drawn: the styling matrix, before the matrix has a UI.
 *
 * Phase 12 lets a user edit this per family. Until then it is a pure function
 * from `(family, value)` to Konva stroke props, which is also what makes it
 * testable without mounting a canvas.
 *
 * The emphasis rules are the ones ASHRAE Chart No. 1 uses, and they carry
 * information rather than decoration: the saturation curve bounds the physical
 * region, so it is the heaviest line on the chart; decade dry-bulb isotherms
 * and the round relative-humidity curves are what a reader counts along.
 */

import { CurveFamilyId } from '../psychro';
import type { ChartTokens } from './useChartTokens';

/** The stroke properties a renderer needs for one curve. */
export interface CurveStyle {
  stroke: string;
  strokeWidth: number;
  opacity: number;
  dash?: number[];
}

/** True when `value` is a multiple of `step`, within floating-point slop. */
function isMultipleOf(value: number, step: number): boolean {
  const scaled = value / step;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/**
 * Whether a curve is a major member of its family, and therefore emphasised.
 *
 * Dry-bulb every 5 °C, humidity ratio every 0.005, enthalpy every 10 kJ/kg.
 * Relative humidity is never "minor": there are only nine of them and each is
 * labelled.
 */
export function isMajor(family: CurveFamilyId, value: number): boolean {
  switch (family) {
    case CurveFamilyId.DryBulb:
      return isMultipleOf(value, 5);
    case CurveFamilyId.HumidityRatio:
      return isMultipleOf(value, 0.005);
    case CurveFamilyId.Enthalpy:
      return isMultipleOf(value, 10);
    case CurveFamilyId.RelativeHumidity:
      return true;
    default:
      return false;
  }
}

/** The saturation curve is 100% relative humidity, and is drawn as the boundary. */
export function isSaturation(family: CurveFamilyId, value: number): boolean {
  return family === CurveFamilyId.RelativeHumidity && Math.abs(value - 1) < 1e-9;
}

/**
 * The stroke for one curve.
 *
 * Wet-bulb and specific volume are dashed because they cross the dry-bulb and
 * enthalpy families at shallow angles, and at a printed chart's density a
 * continuous line of the same weight is genuinely hard to follow to its label.
 */
export function curveStyle(
  family: CurveFamilyId,
  value: number,
  tokens: ChartTokens,
): CurveStyle {
  if (isSaturation(family, value)) {
    return { stroke: tokens.saturation, strokeWidth: 2, opacity: 1 };
  }

  const stroke = tokens.family[family];
  const major = isMajor(family, value);

  switch (family) {
    case CurveFamilyId.RelativeHumidity:
      return { stroke, strokeWidth: 1.1, opacity: 0.9 };
    case CurveFamilyId.WetBulb:
      return { stroke, strokeWidth: 0.8, opacity: 0.75, dash: [5, 4] };
    case CurveFamilyId.SpecificVolume:
      return { stroke, strokeWidth: 0.8, opacity: 0.75, dash: [2, 4] };
    case CurveFamilyId.Enthalpy:
      return { stroke, strokeWidth: major ? 1 : 0.7, opacity: major ? 0.9 : 0.6 };
    default:
      return { stroke, strokeWidth: major ? 1 : 0.6, opacity: major ? 0.9 : 0.55 };
  }
}
