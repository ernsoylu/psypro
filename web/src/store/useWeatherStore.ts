/**
 * The loaded weather year, as the worker reported it.
 *
 * Plain numbers only. The engine handle and the parsed arrays live in the
 * worker, which is what keeps the main thread free — see `epw.worker.ts` for
 * the trace that forced that split.
 *
 * Weather is bring-your-own: nothing is bundled and nothing is fetched. §5 gives
 * two reasons and both hold — hosting global weather data is not viable for an
 * open-source project, and parsing locally keeps a user's project private.
 */

import { create } from 'zustand';

import type { WeatherResult } from '../weather/epw.worker';

/** What the weather store holds. */
export interface WeatherState {
  /** The analysed year, or null. */
  result: WeatherResult | null;
  /** Whether a file has ever been loaded, so a re-bin knows there is one. */
  hasFile: boolean;
  /** True while the worker is busy. */
  loading: boolean;
  /** Why the last load failed, if it did. */
  error: string | null;
  /** Dry-bulb bin increment. §5 asks for 0.5 to 6 degrees. */
  binStepT: number;
  /** Humidity-ratio bin increment, kg/kg_da. */
  binStepW: number;

  setResult: (result: WeatherResult) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setBinStepT: (step: number) => void;
  setBinStepW: (step: number) => void;
}

export const useWeatherStore = create<WeatherState>((set) => ({
  result: null,
  hasFile: false,
  loading: false,
  error: null,
  // One kelvin and one gram per kilogram: fine enough to show a climate's shape,
  // coarse enough that a cell is still a meaningful number of hours.
  binStepT: 1,
  binStepW: 0.001,

  setResult: (result) => set({ result, hasFile: true, loading: false, error: null }),
  setLoading: (loading) => set({ loading, error: null }),
  setError: (error) => set({ error, loading: false }),
  setBinStepT: (binStepT) => set({ binStepT }),
  setBinStepW: (binStepW) => set({ binStepW }),
}));
