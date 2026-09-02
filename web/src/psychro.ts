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
  check_envelope,
  engine_version,
  envelope_polygon,
  fogging_margin,
  generate_base_grid,
  get_chart_extent,
  get_coordinate_mapping,
  mix_air,
  process_load,
  protractor_shr,
  protractor_slope,
  solve_coil,
  solve_coil_from_adp,
  solve_design_air,
  solve_return_air_cycle,
  state_from_chart_coordinates,
  state_from_chart_coordinates_clamped,
  ChartLayout,
  CurveFamilyId,
  InputState,
  StatePointInput,
  type ChartCurve,
  type ChartExtent,
  type ClampedState,
  type CoilOutput,
  type CycleOutput,
  type DesignAirOutput,
  type EnvelopeCheck,
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
  check_envelope,
  engine_version,
  envelope_polygon,
  fogging_margin,
  generate_base_grid,
  get_chart_extent,
  get_coordinate_mapping,
  mix_air,
  process_load,
  protractor_shr,
  protractor_slope,
  solve_coil,
  solve_coil_from_adp,
  solve_design_air,
  solve_return_air_cycle,
  state_from_chart_coordinates,
  state_from_chart_coordinates_clamped,
};
export type {
  ChartCurve,
  ChartExtent,
  ClampedState,
  CoilOutput,
  CycleOutput,
  DesignAirOutput,
  EnvelopeCheck,
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
 *
 * `source` overrides where the module comes from. The browser needs nothing —
 * the generated loader fetches it — but a test runner has no HTTP server, and
 * mocking the engine there would mean a page test asserted the mock rather than
 * the coil. Handing it the bytes off disk instead lets the rendered page be
 * checked against the real thermodynamics.
 */
export function initEngine(source?: BufferSource | WebAssembly.Module): Promise<void> {
  ready ??= (source ? init(source) : init()).then(() => undefined);
  return ready;
}
