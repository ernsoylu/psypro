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
  mix_air,
  InputState,
  StatePointInput,
  type StatePointOutput,
} from './wasm/psychro';

export { InputState, StatePointInput, calculate_state, mix_air, engine_version };
export type { StatePointOutput };

let ready: Promise<void> | null = null;

/**
 * Initialises the WASM module once. Safe to await from many callers.
 */
export function initEngine(): Promise<void> {
  ready ??= init().then(() => undefined);
  return ready;
}
