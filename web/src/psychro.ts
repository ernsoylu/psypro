/**
 * Typed access to the WASM calculation engine.
 *
 * All types come from the generated `./wasm/psychro` definitions. Do not
 * hand-write a mirror of a Rust struct here: `wasm-bindgen` emits the interface,
 * and a second copy will drift.
 */
import init, {
  calculate_state,
  engine_version,
  generate_base_grid,
  get_chart_extent,
  get_coordinate_mapping,
  mix_air,
  state_from_chart_coordinates,
  ChartLayout,
  CurveFamilyId,
  InputState,
  StatePointInput,
  type ChartCurve,
  type ChartExtent,
  type Point2D,
  type StatePointOutput,
} from './wasm/psychro';

export {
  ChartLayout,
  CurveFamilyId,
  InputState,
  StatePointInput,
  calculate_state,
  engine_version,
  generate_base_grid,
  get_chart_extent,
  get_coordinate_mapping,
  mix_air,
  state_from_chart_coordinates,
};
export type { ChartCurve, ChartExtent, Point2D, StatePointOutput };

let ready: Promise<void> | null = null;

/**
 * Initialises the WASM module once. Safe to await from many callers.
 */
export function initEngine(): Promise<void> {
  ready ??= init().then(() => undefined);
  return ready;
}
