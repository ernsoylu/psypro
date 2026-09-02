/**
 * Stored inputs → resolved properties → chart coordinates.
 *
 * The store holds two numbers per point; the chart needs twelve properties and
 * a position. This is the one place that bridges them, and it is a *derivation*
 * rather than a second copy of state: nothing here is stored, so nothing here
 * can go stale against the inputs it came from.
 *
 * Every value comes from a WASM call. There is no TypeScript formula in this
 * file and there must never be one — a "quick" JS approximation for a drag
 * preview is precisely the divergence the architecture rule exists to prevent,
 * and it would show up as a point that jumps when you let go of it.
 */

import { useMemo } from 'react';

import {
  calculate_state,
  get_coordinate_mapping,
  ChartLayout,
  StatePointInput,
  type StatePointOutput,
} from '../psychro';
import type { StatePoint } from './usePsychStore';

/** A point with everything the chart and the panel need. */
export interface ResolvedPoint {
  /** The stored point this came from. */
  point: StatePoint;
  /** All twelve properties, or null if the inputs are not a physical state. */
  state: StatePointOutput | null;
  /** Chart-space position, or null if the state could not be resolved. */
  position: { x: number; y: number } | null;
  /** Why it could not be resolved, if it could not. */
  error: string | null;
}

/** The document settings a resolution depends on. */
export interface ResolveContext {
  isSi: boolean;
  altitudeM: number;
  realGas: boolean;
  layout: ChartLayout;
}

/**
 * Resolves one point.
 *
 * Supersaturated inputs are an ordinary outcome, not an exception to be
 * swallowed: dragging a point above the saturation curve is something a user
 * will do within seconds of picking up the tool. The error text comes back so
 * the panel can say *why* rather than showing blanks.
 */
export function resolvePoint(
  point: StatePoint,
  ctx: ResolveContext,
): ResolvedPoint {
  const input = new StatePointInput(
    point.dryBulb,
    point.secondValue,
    point.mode,
    ctx.altitudeM,
    ctx.isSi,
    ctx.realGas,
  );
  try {
    const state = calculate_state(input);
    const mapped = get_coordinate_mapping(
      new StatePointInput(
        point.dryBulb,
        point.secondValue,
        point.mode,
        ctx.altitudeM,
        ctx.isSi,
        ctx.realGas,
      ),
      ctx.layout,
    );
    return {
      point,
      state,
      position: { x: mapped.x, y: mapped.y },
      error: null,
    };
  } catch (e: unknown) {
    return {
      point,
      state: null,
      position: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Resolves every point in the document.
 *
 * Memoised on the points array and on each context field separately, so the
 * common case — a re-render caused by something else entirely — costs nothing,
 * while a change of elevation correctly re-resolves the lot.
 */
export function useResolvedPoints(
  points: StatePoint[],
  ctx: ResolveContext,
): ResolvedPoint[] {
  const { isSi, altitudeM, realGas, layout } = ctx;
  return useMemo(
    () => points.map((p) => resolvePoint(p, { isSi, altitudeM, realGas, layout })),
    [points, isSi, altitudeM, realGas, layout],
  );
}
