/**
 * Typed access to the WASM calculation engine.
 *
 * All types come from the generated `./wasm/psychro` definitions. Do not
 * hand-write a mirror of a Rust struct here: `wasm-bindgen` emits the interface,
 * and a second copy will drift.
 */
import init, {
  apply_energy_recovery,
  apply_evaporative,
  apply_mixing,
  apply_sensible,
  apply_sensible_duty,
  apply_steam_humidification,
  calculate_state,
  engine_version,
  generate_base_grid,
  get_chart_extent,
  get_coordinate_mapping,
  mix_air,
  process_load,
  protractor_shr,
  protractor_slope,
  state_from_chart_coordinates,
  state_from_chart_coordinates_clamped,
  ChartLayout,
  CurveFamilyId,
  InputState,
  StatePointInput,
  type ChartCurve,
  type ChartExtent,
  type ClampedState,
  type LoadOutput,
  type MixOutput,
  type ProcessOutput,
  type SteamOutput,
  type Point2D,
  type StatePointOutput,
} from './wasm/psychro';

export {
  apply_energy_recovery,
  apply_evaporative,
  apply_mixing,
  apply_sensible,
  apply_sensible_duty,
  apply_steam_humidification,
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
  process_load,
  protractor_shr,
  protractor_slope,
  state_from_chart_coordinates,
  state_from_chart_coordinates_clamped,
};
export type {
  ChartCurve,
  ChartExtent,
  ClampedState,
  LoadOutput,
  MixOutput,
  Point2D,
  ProcessOutput,
  StatePointOutput,
  SteamOutput,
};

let ready: Promise<void> | null = null;

/**
 * Initialises the WASM module once. Safe to await from many callers.
 */
export function initEngine(): Promise<void> {
  ready ??= init().then(() => undefined);
  return ready;
}
