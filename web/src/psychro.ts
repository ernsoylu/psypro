/**
 * Typed access to the WASM calculation engine.
 *
 * All types come from the generated `./wasm/psychro` definitions. Do not
 * hand-write a mirror of a Rust struct here: `wasm-bindgen` emits the interface,
 * and a second copy will drift.
 */
import init, {
  apply_cooling,
  apply_cooling_duty,
  apply_desiccant,
  apply_energy_recovery,
  apply_evaporative,
  apply_mixing,
  apply_sensible,
  apply_sensible_duty,
  apply_steam_humidification,
  bin_weather_data,
  calculate_state,
  chart_lattice,
  count_free_cooling_hours,
  count_hours_inside,
  resolve_weather,
  check_envelope,
  engine_version,
  envelope_polygon,
  explain_state,
  fogging_margin,
  measure_real_gas_correction,
  generate_base_grid,
  get_chart_extent,
  get_coordinate_mapping,
  identify_process,
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
  ProcessFitKind,
  StatePointInput,
  type ChartCurve,
  type ChartExtent,
  type ClampedState,
  type CoilOutput,
  type CoolingOutput,
  type CycleOutput,
  type DesignAirOutput,
  type EnvelopeCheck,
  type HourCounts,
  type LoadOutput,
  type MixOutput,
  type ProcessFitOutput,
  type ProcessOutput,
  type SteamOutput,
  type Point2D,
  type StatePointOutput,
  type ResolvedWeather,
  type WeatherBins,
  type WorkingStep,
} from './wasm/psychro';

export {
  bin_weather_data,
  count_free_cooling_hours,
  count_hours_inside,
  resolve_weather,
  apply_cooling,
  apply_cooling_duty,
  apply_desiccant,
  apply_energy_recovery,
  apply_evaporative,
  apply_mixing,
  apply_sensible,
  apply_sensible_duty,
  apply_steam_humidification,
  ChartLayout,
  CurveFamilyId,
  InputState,
  ProcessFitKind,
  StatePointInput,
  calculate_state,
  chart_lattice,
  check_envelope,
  engine_version,
  envelope_polygon,
  explain_state,
  fogging_margin,
  measure_real_gas_correction,
  generate_base_grid,
  get_chart_extent,
  get_coordinate_mapping,
  identify_process,
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
  CoolingOutput,
  CycleOutput,
  DesignAirOutput,
  EnvelopeCheck,
  HourCounts,
  LoadOutput,
  MixOutput,
  Point2D,
  ProcessFitOutput,
  ProcessOutput,
  ResolvedWeather,
  StatePointOutput,
  SteamOutput,
  WeatherBins,
  WorkingStep,
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
