/**
 * Project-wide settings: unit system, elevation, chart layout.
 *
 * These three are grouped because they share a property nothing else does —
 * **changing any of them invalidates every derived value in the document**. A
 * state point resolved at sea level is not the same point at 1600 m, and a
 * reading in °C is not a reading in °F. Everything downstream treats a change
 * here as a full recompute, which is why they are one store rather than
 * scattered across the components that happen to display them.
 *
 * Plain Zustand with no React import: `src/store/*.test.ts` exercises these
 * headless, which is the point of keeping state logic out of components.
 */

import { create } from 'zustand';

import { ChartLayout } from '../psychro';

/** Metres per foot, for the elevation the engine is given. */
const METRES_PER_FOOT = 0.3048;

/** What the project store holds. */
export interface ProjectState {
  /** Whether the document is expressed in SI. */
  isSi: boolean;
  /** Site elevation, as typed, in the active unit system. */
  altitude: string;
  /** Which chart construction is drawn. */
  layout: ChartLayout;
  /**
   * Whether the real-gas enhancement factor is applied.
   *
   * Off selects this project's own ideal-gas formulations rather than the
   * production backend — the teaching switch from `REQUIREMENTS.md` §11, which
   * exists so a student can see the size of a correction rather than be told it.
   */
  realGas: boolean;
  /** Project name, shown in the nav. */
  name: string;

  setIsSi: (isSi: boolean) => void;
  setAltitude: (altitude: string) => void;
  setLayout: (layout: ChartLayout) => void;
  setRealGas: (realGas: boolean) => void;
  setName: (name: string) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  isSi: true,
  altitude: '0',
  layout: ChartLayout.Ashrae,
  realGas: true,
  name: '',

  setIsSi: (isSi) => set({ isSi }),
  setAltitude: (altitude) => set({ altitude }),
  setLayout: (layout) => set({ layout }),
  setRealGas: (realGas) => set({ realGas }),
  setName: (name) => set({ name }),
}));

/**
 * Site elevation in metres, whatever the document is expressed in.
 *
 * The engine takes metres and only metres — unit handling lives at the WASM
 * boundary and nowhere else — so this is the one conversion the frontend owns.
 * A half-typed entry like `"-"` parses as `NaN`; zero is the honest reading of
 * "no elevation given yet", and letting `NaN` through would poison every
 * property on the chart rather than just this field.
 */
export function altitudeInMetres(state: Pick<ProjectState, 'isSi' | 'altitude'>): number {
  const value = Number(state.altitude);
  if (!Number.isFinite(value)) return 0;
  return state.isSi ? value : value * METRES_PER_FOOT;
}
