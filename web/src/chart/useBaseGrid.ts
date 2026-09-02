/**
 * Layer 0: the cached base grid.
 *
 * The grid depends on unit system, altitude and layout — and on *nothing else*.
 * That is not an optimisation note, it is the contract: `generate_base_grid`
 * walks six curve families, solving a wet-bulb inversion per sampled point, and
 * running it inside a pan gesture would put a WASM round trip on the 60 FPS
 * path. `src/chart/chart.test.ts` asserts the call count across a pan and a
 * zoom, because a rule enforced only by a comment is a rule that lasts until
 * the next refactor.
 */

import { useMemo } from 'react';

import {
  ChartLayout,
  CurveFamilyId,
  generate_base_grid,
  get_chart_extent,
  type ChartCurve,
} from '../psychro';
import type { Extent } from './geometry';

/** The physical window the chart is drawn over. */
export interface ChartDomain {
  /** Lowest dry-bulb temperature shown, °C. */
  tMin: number;
  /** Highest dry-bulb temperature shown, °C. */
  tMax: number;
  /** Lowest humidity ratio shown, kg/kg_da. */
  wMin: number;
  /** Highest humidity ratio shown, kg/kg_da. */
  wMax: number;
}

/** The ASHRAE Chart No. 1 comfort-range window. */
export const DEFAULT_DOMAIN: ChartDomain = {
  tMin: -10,
  tMax: 50,
  wMin: 0,
  wMax: 0.03,
};

/** Everything that invalidates the grid. */
export interface BaseGridParams {
  /** The physical window. */
  domain: ChartDomain;
  /** ASHRAE or Mollier i-x. */
  layout: ChartLayout;
  /** Site elevation in metres — the engine's own unit, not the document's. */
  altitudeM: number;
  /** Whether the enhancement factor is applied. */
  realGas: boolean;
}

/** One drawable curve, flattened for the renderer. */
export interface GridCurve {
  /** Which constant-property family this belongs to. */
  family: CurveFamilyId;
  /** The constant value defining it, in the family's natural units. */
  value: number;
  /** Chart-space coordinates, `[x0, y0, x1, y1, …]`. */
  coords: Float64Array;
}

/** The generated grid, together with the chart-space box it occupies. */
export interface BaseGrid {
  curves: GridCurve[];
  extent: Extent;
}

/** Copies a curve out of WASM memory into a plain object. */
function adopt(curve: ChartCurve): GridCurve {
  // `coords` reads from the WASM heap; taking a copy now means the renderer
  // never holds a view that a later allocation could invalidate.
  return {
    family: curve.family as CurveFamilyId,
    value: curve.value,
    coords: Float64Array.from(curve.coords),
  };
}

/**
 * Generates the base grid, memoised on everything that can invalidate it.
 *
 * The dependency list is spelled out field by field rather than taking
 * `params` whole, so a caller that rebuilds the object every render — which is
 * the normal thing to do — does not silently defeat the cache.
 */
export function useBaseGrid({
  domain,
  layout,
  altitudeM,
  realGas,
}: BaseGridParams): BaseGrid {
  const { tMin, tMax, wMin, wMax } = domain;

  return useMemo(() => {
    const raw = generate_base_grid(tMin, tMax, wMin, wMax, layout, altitudeM, realGas);
    const box = get_chart_extent(tMin, tMax, wMin, wMax, layout);
    return {
      curves: raw.map(adopt),
      extent: {
        x_min: box.x_min,
        x_max: box.x_max,
        y_min: box.y_min,
        y_max: box.y_max,
      },
    };
  }, [tMin, tMax, wMin, wMax, layout, altitudeM, realGas]);
}
