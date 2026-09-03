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
 *
 * # Derived points
 *
 * A point may also be *placed by a process* rather than typed. That is what
 * makes a train of processes possible — OA → mix → coil → fan → room — because
 * the outlet of one process is then a real point with an id, and the next
 * process can start from it.
 *
 * It does not break the rule above. A derived point's stored numbers are a
 * **dormant anchor**: ignored while the process places it, and promoted back to
 * inputs if the process is ever taken away. So the file still carries only
 * inputs, and reopening it recomputes every outlet rather than trusting a
 * snapshot — which is the whole reason the rule exists.
 */

import { create } from 'zustand';

import { InputState } from '../psychro';
import { convertForUnits } from '../units';
import type { DimensionId } from '../units';

/**
 * What kind of quantity each mode's second value is.
 *
 * The panel needs it to label and convert the input; the unit switch needs it
 * to rewrite a stored document. One table, so the two cannot disagree.
 */
export const SECOND_PROPERTY_DIMENSION: Record<InputState, DimensionId> = {
  [InputState.DbtWbt]: 'temperature',
  [InputState.DbtRh]: 'percent',
  [InputState.DbtDewPoint]: 'temperature',
  [InputState.DbtHumidityRatio]: 'humidityRatio',
  [InputState.DbtEnthalpy]: 'enthalpy',
};

/**
 * Where a point's position comes from.
 *
 * Two cases, and the distinction is load-bearing: an `input` point is what the
 * user typed or dragged, an `outlet` point is placed by the process named here.
 * The panel edits the first and links to the second, and the resolver reads the
 * stored numbers only for the first.
 */
export type PointSource =
  | { kind: 'input' }
  | {
      kind: 'outlet';
      /** The process whose outlet this point is. */
      processId: string;
    }
  | {
      kind: 'tear';
      /**
       * The process whose outlet this point stands in for.
       *
       * A **tear stream**. A recirculating circuit is a loop — the mixing box
       * consumes return air, and return air comes from the room the mixing box
       * feeds — and the resolver walks the document once, so a loop has no
       * starting point. Sequential-modular flowsheet solvers have cut loops
       * this way for fifty years: one stream is *specified* rather than
       * computed, and everything else resolves in order from it.
       *
       * In HVAC that stream is already the natural one. The room condition is a
       * design input — you state 24 °C and 50%, you do not compute it — so the
       * tear falls exactly where a designer would put it.
       *
       * The point resolves from its own two stored numbers, like any typed
       * point. What this field adds is the *comparison*: the process upstream
       * still produces a state, and the difference between the two is the
       * convergence error a solver would iterate away. Here it is a number the
       * designer reads, which is more honest than hiding it.
       */
      processId: string;
    };

/** The source every point carries unless it is placed by a process. */
export const TYPED: PointSource = { kind: 'input' };

/** Whether a process places this point rather than the user. */
export function isDerived(point: StatePoint): boolean {
  return point.source.kind === 'outlet';
}

/**
 * The process that places this point, or null when the user does.
 *
 * A **tear** point is not placed by its process — that is the whole point of a
 * tear — so it answers null here and resolves from its own stored numbers.
 */
export function producerOf(point: StatePoint): string | null {
  return point.source.kind === 'outlet' ? point.source.processId : null;
}

/** The process a tear point stands in for, or null when it is not a tear. */
export function tearOf(point: StatePoint): string | null {
  return point.source.kind === 'tear' ? point.source.processId : null;
}

/** Whether this point cuts a loop rather than being computed round it. */
export function isTear(point: StatePoint): boolean {
  return point.source.kind === 'tear';
}

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
  /**
   * Whether the three fields above place this point, or a process does.
   *
   * Optional in the type so every existing call site still reads as it did;
   * absent means typed. The store fills it in on the way through, so a point in
   * the store always carries one.
   */
  source: PointSource;
}

/** A point as a file or a test may hand it over: `source` may be absent. */
export type StoredPoint = Omit<StatePoint, 'source'> & { source?: PointSource };

/** A point being created, before it has an id. */
export type NewStatePoint = Omit<StatePoint, 'id' | 'source'> &
  Partial<Pick<StatePoint, 'source'>>;

/** What the document store holds. */
export interface PsychState {
  /** Every point in the document, in creation order. */
  points: StatePoint[];
  /** Which point the properties panel is editing, if any. */
  selectedId: string | null;

  addPoint: (point: NewStatePoint) => string;
  /**
   * Adds a point that a process places.
   *
   * The seed is the dormant anchor described in this module's header: the
   * numbers the point falls back to if the process is ever removed. Seeding it
   * from the inlet rather than from zero means a detached outlet lands somewhere
   * physical even before the first resolution.
   */
  addOutletPoint: (
    processId: string,
    label: string,
    seed: Omit<NewStatePoint, 'label'>,
  ) => string;
  /**
   * Promotes a derived point to a typed one, at the state it currently holds.
   *
   * Called when the process that placed it goes away but something downstream
   * still consumes it. The snapshot is written *at that edit*, which is a user
   * action rather than a cached derivation — the distinction the header draws.
   */
  detachPoint: (id: string, snapshot: Omit<NewStatePoint, 'label' | 'source'>) => void;
  updatePoint: (id: string, patch: Partial<NewStatePoint>) => void;
  removePoint: (id: string) => void;
  /** Drops the outlet points a process placed, for when that process is deleted. */
  removeOutletsOf: (processId: string) => void;
  selectPoint: (id: string | null) => void;
  /**
   * Replaces the whole document, for file open and for tests.
   *
   * `source` is optional on the way in — a version 1 project file has no such
   * field, and a point without one is a typed point.
   */
  replaceAll: (points: StoredPoint[]) => void;
  /**
   * Rewrites every point for a new unit system.
   *
   * A point is stored as two numbers in the document's units, so the switch has
   * to convert them: 24 °C is 75.2 °F, and leaving the 24 alone would move the
   * point rather than relabel it.
   */
  setForUnits: (toSi: boolean) => void;
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

/** The prefix every generated point id carries. */
const ID_PREFIX = 'pt-';

/** A fresh identifier. Monotonic rather than random: reproducible in tests. */
function nextId(): string {
  counter += 1;
  return `${ID_PREFIX}${counter}`;
}

/**
 * Moves the counter past every id in a document that was handed to us.
 *
 * A project file carries the ids it was saved with, and the counter starts at
 * zero in a fresh session. Without this, opening a file with `pt-1` and then
 * adding a point mints a *second* `pt-1` — and every lookup in the store is by
 * id, so selecting one of them selects both and editing one edits both.
 */
function adoptIds(points: readonly { id: string }[]): void {
  for (const p of points) {
    if (!p.id.startsWith(ID_PREFIX)) continue;
    const n = Number(p.id.slice(ID_PREFIX.length));
    if (Number.isInteger(n) && n > counter) counter = n;
  }
}

export const usePsychStore = create<PsychState>((set) => ({
  points: [],
  selectedId: null,

  addPoint: (point) => {
    const id = nextId();
    // Selecting on add is what makes click-to-place feel like one gesture: the
    // panel is already showing the point you just dropped.
    set((s) => ({
      points: [...s.points, { source: TYPED, ...point, id }],
      selectedId: id,
    }));
    return id;
  },

  addOutletPoint: (processId, label, seed) => {
    const id = nextId();
    set((s) => ({
      points: [
        ...s.points,
        { ...seed, label, id, source: { kind: 'outlet', processId } },
      ],
      // Deliberately *not* selected: the gesture that created this point was
      // "add a process", and the thing the user then wants to edit is the
      // process, not the point it happened to produce.
    }));
    return id;
  },

  detachPoint: (id, snapshot) =>
    set((s) => ({
      points: s.points.map((p) =>
        p.id === id ? { ...p, ...snapshot, source: TYPED } : p,
      ),
    })),

  removeOutletsOf: (processId) =>
    set((s) => {
      const kept = s.points.filter((p) => producerOf(p) !== processId);
      return {
        points: kept,
        selectedId: kept.some((p) => p.id === s.selectedId) ? s.selectedId : null,
      };
    }),

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

  replaceAll: (points) => {
    adoptIds(points);
    set({
      points: points.map((p) => ({ source: TYPED, ...p })),
      selectedId: null,
    });
  },

  setForUnits: (toSi) =>
    set((s) => ({
      points: s.points.map((p) => ({
        ...p,
        dryBulb: convertForUnits('temperature', p.dryBulb, toSi),
        secondValue: convertForUnits(
          SECOND_PROPERTY_DIMENSION[p.mode],
          p.secondValue,
          toSi,
        ),
      })),
    })),
}));

/** The selected point, or null. */
export function selectedPoint(state: PsychState): StatePoint | null {
  return state.points.find((p) => p.id === state.selectedId) ?? null;
}

/** Resets the id counter. Test-only; production ids are never reused. */
export function resetIdCounter(): void {
  counter = 0;
}
