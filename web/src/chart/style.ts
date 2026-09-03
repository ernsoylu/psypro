/**
 * How a curve is drawn.
 *
 * Every gridline, on the canvas and in the SVG export, is styled by
 * `curveStyle`. Pure function, no store access: callers pass the theme tokens
 * and the styling matrix, which keeps this testable and keeps both drawing
 * paths — Konva and SVG — agreeing on what a curve looks like.
 *
 * The defaults live in `DEFAULT_STYLES` (the style store). When no matrix is
 * passed, `curveStyle` styles curves exactly as the store's defaults say — the
 * matrix's defaults *are* the chart's historical drawing. Two deliberate
 * normalisations came with that: specific-volume dashes were [2, 4] and are now
 * the same [5, 4] the wet-bulb family uses, and dry-bulb / humidity-ratio
 * minor lines were 0.6 wide and are now 0.7 (the shared minor ratio). Both are
 * cosmetic shifts, not fixes to the geometry.
 */

import { CurveFamilyId } from '../psychro';
import { DEFAULT_STYLES, type FamilyStyle, type LineStyle } from '../store/useStyleStore';
import type { ChartTokens } from './useChartTokens';

/** The computed stroke properties of one curve. */
export interface CurveStyle {
  /** The CSS colour of the stroke. */
  stroke: string;
  /** Stroke width in pixels. */
  strokeWidth: number;
  /** Stroke opacity; lines that cross others fade so the crossings stay legible. */
  opacity: number;
  /** Dash pattern in pixels along the curve, when the family is dashed. */
  dash?: number[];
}

/**
 * The dash pattern of each line style, in pixels along the curve.
 *
 * Solid has no pattern. Dotted is a 1px mark with a 3px gap — at chart scales a
 * round-cap dot reads as a dot, not a smear. Dashed matches the pattern the
 * wet-bulb family has always drawn with.
 */
export const DASH_PATTERN: Record<LineStyle, number[] | undefined> = {
  solid: undefined,
  dotted: [1, 3],
  dashed: [5, 4],
};

/** Minor lines are drawn at this fraction of the family's width. */
export const MINOR_WIDTH_RATIO = 0.7;

/** Which members of a family count as multiples of the labelled step. */
function isMultipleOf(value: number, step: number): boolean {
  const q = value / step;
  return Math.abs(q - Math.round(q)) < 1e-6;
}

/**
 * Whether a curve is emphasised in its family.
 *
 * - Dry-bulb: every 5° (labelled step).
 * - Humidity ratio: every 0.005 kg/kg (labelled step).
 * - Enthalpy: every 10 kJ/kg (labelled step).
 * - Relative humidity: each curve is labelled, so every one is major.
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

/** Saturation is the 100% relative-humidity curve, and only that curve. */
export function isSaturation(family: CurveFamilyId, value: number): boolean {
  return family === CurveFamilyId.RelativeHumidity && Math.abs(value - 1) < 1e-9;
}

/** Rounds a stroke width so exports do not carry float noise like 0.54000000000000004. */
function widthFor(style: FamilyStyle, major: boolean): number {
  const w = major ? style.width : style.width * MINOR_WIDTH_RATIO;
  return Math.round(w * 100) / 100;
}

/**
 * The stroke properties of one gridline.
 *
 * The saturation curve is treated first and specially: it follows the colour a
 * reader chose for relative humidity — it *is* 100% RH — but keeps its own
 * solid line and weight, because it is the boundary of the physical region
 * rather than one more gridline. Dashes and width overrides deliberately do not
 * reach it.
 *
 * Opacity semantics are the chart's historical ones and are not part of the
 * styling matrix: lines that cross others at shallow angles fade so the
 * crossings stay legible.
 */
export function curveStyle(
  family: CurveFamilyId,
  value: number,
  tokens: ChartTokens,
  styles: Record<CurveFamilyId, FamilyStyle> = DEFAULT_STYLES,
): CurveStyle {
  if (isSaturation(family, value)) {
    return {
      stroke: styles[CurveFamilyId.RelativeHumidity].color ?? tokens.saturation,
      strokeWidth: 2,
      opacity: 1,
    };
  }

  const style = styles[family];
  const stroke = style.color ?? tokens.family[family];
  const dash = DASH_PATTERN[style.lineStyle];
  const major = isMajor(family, value);

  switch (family) {
    case CurveFamilyId.RelativeHumidity:
      // Every RH curve is labelled, so every one is full strength.
      return { stroke, strokeWidth: style.width, opacity: 0.9, ...(dash && { dash }) };
    case CurveFamilyId.WetBulb:
    case CurveFamilyId.SpecificVolume:
      // Both cross the other families at shallow angles; a lighter touch keeps
      // the crossings legible.
      return { stroke, strokeWidth: style.width, opacity: 0.75, ...(dash && { dash }) };
    case CurveFamilyId.Enthalpy:
      return {
        stroke,
        strokeWidth: widthFor(style, major),
        opacity: major ? 0.9 : 0.6,
        ...(dash && { dash }),
      };
    default:
      // Dry-bulb and humidity ratio: decade emphasis.
      return {
        stroke,
        strokeWidth: widthFor(style, major),
        opacity: major ? 0.9 : 0.55,
        ...(dash && { dash }),
      };
  }
}
