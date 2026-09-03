/**
 * Processes: the vectors joining state points, and what they cost.
 *
 * A process is stored as **what it does**, not as where it ends up. A sensible
 * heating process holds "to 23 °C at 2 kg/s"; its outlet is derived. That is the
 * same decision `usePsychStore` makes about points, and for the same reason —
 * change the elevation and every outlet moves, because the physics moved.
 *
 * It also means a process cannot become inconsistent with its endpoints, which
 * is the failure a stored outlet produces the first time someone drags the
 * inlet.
 */

import { create } from 'zustand';

import { convertForUnits } from '../units';

/** The elementary processes from `REQUIREMENTS.md` §4.1. */
export type ProcessKind =
  /** Humidity ratio held, dry bulb moved. Horizontal on the chart. */
  | 'sensible'
  /** A duty in kW or Btu/h rather than a target temperature. */
  | 'sensibleDuty'
  /** Isothermal humidification by steam injection. */
  | 'steam'
  /** Adiabatic humidification along a constant wet-bulb line. */
  | 'evaporative'
  /** Air-to-air recovery against a second stream, per Standard 84. */
  | 'recovery'
  /** Adiabatic mixing of two streams on a dry-air mass basis. */
  | 'mix'
  /** A straight line between two points that already exist. */
  | 'link';

/** A process in the document. */
export interface Process {
  /** Stable identity. */
  id: string;
  /** What it does. */
  kind: ProcessKind;
  /** The point the air enters at. */
  fromId: string;
  /**
   * The second point.
   *
   * The other stream for `mix` and `recovery`; the destination for `link`.
   * Unused by the processes that derive their own outlet.
   */
  secondId: string | null;
  /** Dry-air mass flow, kg/s or lb/h. Never `V̇ · ρ_moist`. */
  mdot: number;
  /** Second-stream mass flow, for `mix`. */
  mdotSecond: number;
  /** Target dry-bulb temperature, for `sensible`. */
  targetT: number;
  /** Duty, for `sensibleDuty`. */
  duty: number;
  /** Target humidity ratio, for `steam`. */
  targetW: number;
  /** Injected steam enthalpy, for `steam`. */
  steamEnthalpy: number;
  /** Saturation effectiveness, for `evaporative`. */
  effectiveness: number;
  /** Sensible effectiveness, for `recovery`. */
  epsSensible: number;
  /** Latent effectiveness, for `recovery`. Zero for the sensible-only family. */
  epsLatent: number;
}

/** A process being created, before it has an id. */
export type NewProcess = Omit<Process, 'id'>;

/**
 * Defaults that produce a *visible, physical* process on the first click.
 *
 * A process that resolves to nothing teaches nothing, and "add a process, then
 * fill in six numbers before anything appears" is how a tool loses a student in
 * the first minute.
 */
export function defaultProcess(kind: ProcessKind, fromId: string): NewProcess {
  return {
    kind,
    fromId,
    secondId: null,
    mdot: 1,
    mdotSecond: 1,
    targetT: 30,
    duty: 10,
    targetW: 0.012,
    // Dry saturated steam at 100 °C: h_g = 2676 kJ/kg.
    steamEnthalpy: 2676,
    // 300 mm rigid media, from §4.3's table.
    effectiveness: 0.88,
    epsSensible: 0.75,
    epsLatent: 0.6,
  };
}

/** What the process store holds. */
export interface ProcessState {
  processes: Process[];
  selectedId: string | null;

  addProcess: (process: NewProcess) => string;
  updateProcess: (id: string, patch: Partial<NewProcess>) => void;
  removeProcess: (id: string) => void;
  selectProcess: (id: string | null) => void;
  /** Drops every process touching a point, for when that point is deleted. */
  removeForPoint: (pointId: string) => void;
  /** Replaces the whole list, for file open and for tests. */
  replaceAll: (processes: Process[]) => void;
  /**
   * Rewrites every process for a new unit system.
   *
   * A flow, a duty and a target temperature are quantities like a point's, and
   * the effectivenesses are ratios that carry across untouched.
   */
  setForUnits: (toSi: boolean) => void;
}

let counter = 0;

/** The prefix every generated process id carries. */
const ID_PREFIX = 'pr-';

function nextId(): string {
  counter += 1;
  return `${ID_PREFIX}${counter}`;
}

/**
 * Moves the counter past every id in a document that was handed to us.
 *
 * Same reason as `usePsychStore.adoptIds`: a saved file carries its own ids,
 * and minting a duplicate makes two processes respond to one selection.
 */
function adoptIds(processes: readonly Process[]): void {
  for (const p of processes) {
    if (!p.id.startsWith(ID_PREFIX)) continue;
    const n = Number(p.id.slice(ID_PREFIX.length));
    if (Number.isInteger(n) && n > counter) counter = n;
  }
}

export const useProcessStore = create<ProcessState>((set) => ({
  processes: [],
  selectedId: null,

  addProcess: (process) => {
    const id = nextId();
    set((s) => ({ processes: [...s.processes, { ...process, id }], selectedId: id }));
    return id;
  },

  updateProcess: (id, patch) =>
    set((s) => ({
      processes: s.processes.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),

  removeProcess: (id) =>
    set((s) => ({
      processes: s.processes.filter((p) => p.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  selectProcess: (selectedId) => set({ selectedId }),

  removeForPoint: (pointId) =>
    set((s) => {
      // A process whose inlet has been deleted is not a process; leaving it
      // behind would draw a line from nowhere.
      const kept = s.processes.filter(
        (p) => p.fromId !== pointId && p.secondId !== pointId,
      );
      return {
        processes: kept,
        selectedId: kept.some((p) => p.id === s.selectedId) ? s.selectedId : null,
      };
    }),

  replaceAll: (processes) => {
    adoptIds(processes);
    set({ processes, selectedId: null });
  },

  setForUnits: (toSi) =>
    set((s) => ({
      processes: s.processes.map((p) => ({
        ...p,
        mdot: convertForUnits('flow', p.mdot, toSi),
        mdotSecond: convertForUnits('flow', p.mdotSecond, toSi),
        targetT: convertForUnits('temperature', p.targetT, toSi),
        duty: convertForUnits('power', p.duty, toSi),
        targetW: convertForUnits('humidityRatio', p.targetW, toSi),
        steamEnthalpy: convertForUnits('enthalpy', p.steamEnthalpy, toSi),
      })),
    })),
}));

/** Resets the id counter. Test-only; production ids are never reused. */
export function resetProcessIdCounter(): void {
  counter = 0;
}
