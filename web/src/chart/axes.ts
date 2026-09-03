/**
 * Axis ticks and curve labels, derived from the grid rather than recomputed.
 *
 * Nothing here evaluates a psychrometric property. Every tick anchor is an
 * *endpoint of a curve the engine already produced*: a dry-bulb tick sits where
 * that isotherm meets the dry edge of the domain, a humidity-ratio tick where
 * that line meets the warm edge. That is the whole trick, and it is why this
 * file contains no constants — reimplementing `σ = t·(c_p,da + c_p,wv·W)` in
 * TypeScript to place a tick is exactly the parallel-formula drift the
 * architecture rule in `CLAUDE.md` forbids.
 *
 * It also means the ticks cannot disagree with the lines they label, which is
 * the failure mode that makes a chart quietly untrustworthy.
 */

import { ChartLayout, CurveFamilyId } from '../psychro';
import { convertForUnits } from '../units';
import type { GridCurve } from './useBaseGrid';

/** Which chart-space axis carries which quantity, per layout. */
interface AxisRoles {
  /** Index into a `[x, y]` pair for the humidity-ratio axis. */
  humidity: 0 | 1;
  /** Index into a `[x, y]` pair for the reduced sensible coordinate. */
  reduced: 0 | 1;
}

function axisRoles(layout: ChartLayout): AxisRoles {
  // ASHRAE puts the reduced coordinate horizontal; Mollier i-x exchanges them.
  return layout === ChartLayout.MollierIx
    ? { humidity: 0, reduced: 1 }
    : { humidity: 1, reduced: 0 };
}

/** A label to draw, positioned in chart space. */
export interface ChartLabel {
  /** Stable across renders, so React can keep the node. */
  key: string;
  /** Chart-space anchor. */
  x: number;
  y: number;
  /** Screen-space nudge applied after projection, in pixels. */
  dx: number;
  dy: number;
  /** The rendered text. */
  text: string;
  /** Which family styles it. */
  family: CurveFamilyId;
  /** Horizontal alignment about the anchor. */
  align: 'left' | 'center' | 'right';
}

/** Reads the `i`-th vertex of a flat coordinate run. */
function vertex(coords: Float64Array, i: number): [number, number] {
  return [coords[2 * i] ?? 0, coords[2 * i + 1] ?? 0];
}

/** The endpoint of a curve that is extreme along `axis`. */
function endpoint(
  curve: GridCurve,
  axis: 0 | 1,
  pick: 'min' | 'max',
): [number, number] | null {
  const n = curve.coords.length / 2;
  if (n < 1) return null;
  const first = vertex(curve.coords, 0);
  const last = vertex(curve.coords, n - 1);
  const better = pick === 'min' ? first[axis] <= last[axis] : first[axis] >= last[axis];
  return better ? first : last;
}

/** A vertex partway along a curve, for a label that sits on the line. */
function alongCurve(curve: GridCurve, fraction: number): [number, number] | null {
  const n = curve.coords.length / 2;
  if (n < 1) return null;
  return vertex(curve.coords, Math.min(n - 1, Math.round((n - 1) * fraction)));
}

/** Formats a humidity ratio the way a chart axis does. */
function formatW(value: number): string {
  return value.toFixed(3);
}

/**
 * A curve's constant value, written in the document's units.
 *
 * The base grid is generated over an SI domain and every `value` on it is SI:
 * °C for dry bulb, kJ/kg_da for enthalpy. The axis *title* already reads "°F"
 * on an IP document, so without this a reader saw a line labelled `24` under a
 * caption that said it was Fahrenheit.
 *
 * Only the numeral is converted. The gridlines themselves stay on the SI
 * lattice, so an IP chart is drawn at round SI intervals rather than round IP
 * ones — that needs an IP `GridSpec` in the engine, not a change here.
 */
function inDocumentUnits(family: CurveFamilyId, value: number, isSi: boolean): number {
  if (isSi) return value;
  if (family === CurveFamilyId.DryBulb)
    return convertForUnits('temperature', value, false);
  if (family === CurveFamilyId.Enthalpy) return convertForUnits('enthalpy', value, false);
  return value;
}

/** How far the axis numerals sit outside the plotted region, in pixels. */
const TICK_OFFSET = 6;

/**
 * Every label the chart draws, in chart space.
 *
 * Only *major* members get a numeral — every 5 °C, every 0.005 kg/kg, every
 * 10 kJ/kg — because at the default density a numeral per gridline is unreadable
 * before it is informative. Wet-bulb and specific volume are deliberately
 * unlabelled here: they cross the other families at shallow angles, and their
 * scales belong on the saturation line, which arrives with the protractor.
 */
export function chartLabels(
  curves: GridCurve[],
  layout: ChartLayout,
  isSi = true,
): ChartLabel[] {
  const { humidity, reduced } = axisRoles(layout);
  const out: ChartLabel[] = [];
  const shown = (family: CurveFamilyId, value: number) =>
    inDocumentUnits(family, value, isSi);

  // Dry-bulb: numbered where each isotherm meets the driest edge of the domain,
  // which is the bottom of an ASHRAE chart and the left of a Mollier one.
  for (const curve of curves) {
    if (curve.family !== CurveFamilyId.DryBulb) continue;
    if (Math.abs(curve.value / 5 - Math.round(curve.value / 5)) > 1e-6) continue;
    const at = endpoint(curve, humidity, 'min');
    if (!at) continue;
    out.push({
      key: `t:${curve.value}`,
      x: at[0],
      y: at[1],
      dx: humidity === 1 ? 0 : -TICK_OFFSET,
      dy: humidity === 1 ? TICK_OFFSET : 0,
      text: String(Math.round(shown(CurveFamilyId.DryBulb, curve.value))),
      family: CurveFamilyId.DryBulb,
      align: humidity === 1 ? 'center' : 'right',
    });
  }

  // Humidity ratio: numbered where each line meets the warmest edge.
  for (const curve of curves) {
    if (curve.family !== CurveFamilyId.HumidityRatio) continue;
    if (Math.abs(curve.value / 0.005 - Math.round(curve.value / 0.005)) > 1e-6) continue;
    const at = endpoint(curve, reduced, 'max');
    if (!at) continue;
    out.push({
      key: `w:${curve.value}`,
      x: at[0],
      y: at[1],
      dx: reduced === 0 ? TICK_OFFSET : 0,
      dy: reduced === 0 ? 0 : -TICK_OFFSET,
      text: formatW(curve.value),
      family: CurveFamilyId.HumidityRatio,
      align: reduced === 0 ? 'left' : 'center',
    });
  }

  // Relative humidity: on the curve itself, which is how a chart reader finds
  // it — there is no edge to hang an RH scale from.
  for (const curve of curves) {
    if (curve.family !== CurveFamilyId.RelativeHumidity) continue;
    if (Math.abs(curve.value - 1) < 1e-9) continue;
    // Spread the numerals down the family instead of stacking them all at the
    // same fraction: the curves converge toward saturation, so a constant
    // fraction piles 90%, 80% and 70% on top of each other.
    const at = alongCurve(curve, 0.4 + 0.45 * (1 - curve.value));
    if (!at) continue;
    out.push({
      key: `rh:${curve.value}`,
      x: at[0],
      y: at[1],
      dx: 0,
      dy: -TICK_OFFSET,
      text: `${Math.round(curve.value * 100)}%`,
      family: CurveFamilyId.RelativeHumidity,
      align: 'center',
    });
  }

  // Enthalpy: at the wet end of each isenthalp, where a real chart carries the
  // scale that pairs with the SHR protractor.
  for (const curve of curves) {
    if (curve.family !== CurveFamilyId.Enthalpy) continue;
    if (Math.abs(curve.value / 10 - Math.round(curve.value / 10)) > 1e-6) continue;
    const at = endpoint(curve, humidity, 'max');
    if (!at) continue;
    out.push({
      key: `h:${curve.value}`,
      x: at[0],
      y: at[1],
      dx: -TICK_OFFSET,
      dy: -TICK_OFFSET,
      text: isSi
        ? String(Math.round(curve.value))
        : shown(CurveFamilyId.Enthalpy, curve.value).toFixed(1),
      family: CurveFamilyId.Enthalpy,
      align: 'right',
    });
  }

  return out;
}
