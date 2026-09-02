/**
 * The document being edited: state points, and later the processes joining
 * them.
 *
 * A point is stored as **the two inputs that define it**, not as the twelve
 * properties they resolve to. That is the whole design decision here, and it
 * has three consequences worth stating:
 *
 * * Changing elevation or the unit system re-resolves every point from its own
 *   inputs. Storing the derived properties would leave a document full of
 *   readings taken at a pressure it is no longer at.
 * * A point dragged on the chart and a point typed into the panel are the same
 *   thing — the drag just writes different inputs. There is no "chart point"
 *   and "manual point" to keep in step.
 * * A saved file is small and stable: two numbers and a mode, not a snapshot of
 *   whatever the engine returned on the day it was written.
 */

import { create } from 'zustand';

import { InputState } from '../psychro';

/** A named state point, stored as its defining inputs. */
export interface StatePoint {
  /** Stable identity, so a drag does not depend on list position. */
  id: string;
  /** Short label drawn on the chart, e.g. `OA`, `RA`, `SA`. */
  label: string;
  /** Dry-bulb temperature, in the document's unit system. */
  dryBulb: number;
  /** Which second property is given. */
  mode: InputState;
  /** The second property's value, in the document's unit system. */
  secondValue: number;
}

/** A point being created, before it has an id. */
export type NewStatePoint = Omit<StatePoint, 'id'>;

/** What the document store holds. */
export interface PsychState {
  /** Every point in the document, in creation order. */
  points: StatePoint[];
  /** Which point the properties panel is editing, if any. */
  selectedId: string | null;

  addPoint: (point: NewStatePoint) => string;
  updatePoint: (id: string, patch: Partial<NewStatePoint>) => void;
  removePoint: (id: string) => void;
  selectPoint: (id: string | null) => void;
  /** Replaces the whole document, for file open and for tests. */
  replaceAll: (points: StatePoint[]) => void;
}

/**
 * The default labels, in the order a designer usually places them.
 *
 * Outdoor air, return air, mixed air, coil leaving, supply air — the primary
 * return-air cycle from `REQUIREMENTS.md` §4.9. After those it falls back to
 * numbering, because guessing further is worse than not guessing.
 */
const DEFAULT_LABELS = ['OA', 'RA', 'MA', 'CL', 'SA'];

/** The next unused default label. */
export function nextLabel(existing: readonly StatePoint[]): string {
  const taken = new Set(existing.map((p) => p.label));
  const free = DEFAULT_LABELS.find((label) => !taken.has(label));
  if (free) return free;
  let n = existing.length + 1;
  while (taken.has(`P${n}`)) n += 1;
  return `P${n}`;
}

let counter = 0;

/** A fresh identifier. Monotonic rather than random: reproducible in tests. */
function nextId(): string {
  counter += 1;
  return `pt-${counter}`;
}

export const usePsychStore = create<PsychState>((set) => ({
  points: [],
  selectedId: null,

  addPoint: (point) => {
    const id = nextId();
    // Selecting on add is what makes click-to-place feel like one gesture: the
    // panel is already showing the point you just dropped.
    set((s) => ({ points: [...s.points, { ...point, id }], selectedId: id }));
    return id;
  },

  updatePoint: (id, patch) =>
    set((s) => ({
      points: s.points.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),

  removePoint: (id) =>
    set((s) => ({
      points: s.points.filter((p) => p.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  selectPoint: (selectedId) => set({ selectedId }),

  replaceAll: (points) => set({ points, selectedId: null }),
}));

/** The selected point, or null. */
export function selectedPoint(state: PsychState): StatePoint | null {
  return state.points.find((p) => p.id === state.selectedId) ?? null;
}

/** Resets the id counter. Test-only; production ids are never reused. */
export function resetIdCounter(): void {
  counter = 0;
}
