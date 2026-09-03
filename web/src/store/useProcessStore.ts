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

import type { StatePointOutput } from '../psychro';
import { convertForUnits } from '../units';
import type { DimensionId } from '../units';

/** The elementary processes from `REQUIREMENTS.md` §4.1. */
export type ProcessKind =
  /**
   * Heating or cooling to a target dry-bulb temperature.
   *
   * Horizontal while the coil stays dry, and **not** horizontal when it does
   * not: a target below the entering dew point makes the coil wet, water comes
   * out, and the engine reports the coil rather than refusing the request.
   */
  | 'sensible'
  /** The same, by a duty in kW or Btu/h rather than to a temperature. */
  | 'sensibleDuty'
  /**
   * A cooling coil stated the way equipment is selected: an apparatus dew point
   * and a bypass factor, with the leaving state derived.
   */
  | 'cooling'
  /** Isothermal humidification by steam injection. */
  | 'steam'
  /** Adiabatic humidification along a constant wet-bulb line. */
  | 'evaporative'
  /** Desiccant dehumidification: warmer and drier, the mirror of evaporative. */
  | 'desiccant'
  /** Air-to-air recovery against a second stream, per Standard 84. */
  | 'recovery'
  /** Adiabatic mixing of two streams on a dry-air mass basis. */
  | 'mix'
  /**
   * A load applied to the airstream: a room, a zone, any space gain.
   *
   * The block that closes a circuit. Everything else conditions air on its way
   * somewhere; this is the somewhere.
   */
  | 'load'
  /**
   * One airstream divided in two at a flow ratio, both at the same state.
   *
   * No thermodynamics — a relief damper conditions nothing — but a
   * recirculating circuit cannot be drawn without it, and the flow bookkeeping
   * has to live where a mass balance can check it.
   */
  | 'split'
  /** A straight line between two points that already exist. */
  | 'link';

/**
 * Whether this kind places its own outlet point.
 *
 * Everything except `link` does: `link` joins two points the user already has,
 * so its endpoint is `secondId` and there is nothing to derive. This is the
 * predicate the document actions branch on when they create or remove a
 * process, and it lives here so the two cannot disagree.
 */
export function derivesOutlet(kind: ProcessKind): boolean {
  return kind !== 'link';
}

/** Whether this kind places a *second* outlet as well. */
export function derivesSecondOutlet(kind: ProcessKind): boolean {
  return kind === 'split';
}

/** Whether this kind consumes a second existing point. */
export function needsSecondPoint(kind: ProcessKind): boolean {
  return kind === 'mix' || kind === 'recovery' || kind === 'link';
}

/** A process in the document. */
export interface Process {
  /** Stable identity. */
  id: string;
  /** What it does. */
  kind: ProcessKind;
  /** The point the air enters at. */
  fromId: string;
  /**
   * The second point this process places, for the kinds with two outlets.
   *
   * Only `split` has one. Both branches carry the entering state and differ
   * only in flow, so this is a second *wire* rather than a second answer.
   */
  toSecondId: string | null;
  /**
   * The point this process *places*, for the kinds that derive their outlet.
   *
   * Null for `link`, whose endpoint is `secondId`. This is the field that makes
   * a train of processes possible: the outlet is a real point with an id, so the
   * next process can name it as its inlet.
   */
  toId: string | null;
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
  /**
   * Latent effectiveness. `recovery`'s ε_L on humidity ratio, and the
   * desiccant's `(W_in − W_out)/(W_in − W_eq)` — the same definition against a
   * different reference, which is why it is one field.
   *
   * Zero for the sensible-only recovery family: fixed plate, heat wheel, heat
   * pipe, run-around loop, thermosiphon.
   */
  epsLatent: number;
  /**
   * The fraction of the airstream that never touches the coil surface.
   *
   * Acts on `sensible`, `sensibleDuty` and `cooling`. It does nothing at all
   * while a coil is dry, which is most of the time — and everything the moment
   * the target crosses the entering dew point, because it is what decides how
   * much of the air leaves at the surface condition.
   */
  bypassFactor: number;
  /** Apparatus dew point, for `cooling`. */
  tAdp: number;
  /** The desiccant's equilibrium humidity ratio, `W_eq`. */
  wEquilibrium: number;
  /** Room sensible gain, for `load`. Positive is heat into the air. */
  qSensible: number;
  /** Room latent gain, for `load`. */
  qLatent: number;
  /** The share of the flow leaving by the first branch, for `split`. */
  splitFraction: number;
}

/** A process being created, before it has an id. */
export type NewProcess = Omit<Process, 'id'>;

/**
 * Defaults that produce a *visible, physical* process on the first click.
 *
 * A process that resolves to nothing teaches nothing, and "add a process, then
 * fill in six numbers before anything appears" is how a tool loses a student in
 * the first minute.
 *
 * The defaults are therefore read **off the inlet**, in the document's own
 * units. The previous constants — `targetT: 30`, `targetW: 0.012` — were SI
 * numbers applied unconverted to an IP document, so adding a heating process in
 * IP asked to heat the air to 30 °F, and adding one to a 35 °C outdoor point
 * asked to cool it by five degrees and called it heating.
 */
export function defaultProcess(
  kind: ProcessKind,
  fromId: string,
  ctx: ProcessDefaults = {},
): NewProcess {
  const { inlet, isSi = true } = ctx;
  const si = (dimension: DimensionId, value: number) =>
    isSi ? value : convertForUnits(dimension, value, false);

  // Ten kelvin, which is 18 °F of *difference* and not 50 °F of temperature.
  const step = si('temperatureDelta', 10);
  const t = inlet?.dbt;
  const w = inlet?.humidity_ratio;
  // Warm air wants cooling and cool air wants heating. Any rule here is a
  // guess; this one is right for the two cases a reader arrives with, and it is
  // visible and editable either way.
  const warm = t !== undefined && t > si('temperature', 22);
  const target = t === undefined ? si('temperature', 30) : warm ? t - step : t + step;

  return {
    kind,
    fromId,
    toId: null,
    toSecondId: null,
    secondId: null,
    mdot: si('flow', 1),
    mdotSecond: si('flow', 1),
    targetT: target,
    duty: warm ? -si('power', 10) : si('power', 10),
    // Two grams per kilogram of dry air: the smallest step a humidifier is
    // worth drawing, and a visible one on the chart.
    targetW: (w ?? si('humidityRatio', 0.008)) + si('humidityRatio', 0.002),
    // Dry saturated steam at 100 °C: h_g = 2676 kJ/kg.
    steamEnthalpy: si('enthalpy', 2676),
    // 300 mm rigid media, from §4.3's table.
    effectiveness: 0.88,
    epsSensible: 0.75,
    epsLatent: 0.6,
    bypassFactor: DEFAULT_BYPASS_FACTOR,
    // Far enough below the inlet to condense, close enough to be a coil a
    // chiller could actually feed.
    tAdp: t === undefined ? si('temperature', 10) : t - 1.5 * step,
    // A regenerated wheel's equilibrium, in the range §4.4's wheels reach.
    wEquilibrium: si('humidityRatio', 0.002),
    // A moderate office space at the §4.9 split: RSHF 0.8.
    qSensible: si('power', 20),
    qLatent: si('power', 5),
    // An even division, which is visible and obviously provisional. Any other
    // default would look like a recommendation.
    splitFraction: 0.5,
  };
}

/**
 * The bypass factor a wet coil runs at unless the user says otherwise.
 *
 * Mirrors `psychro_core::process::DEFAULT_BYPASS_FACTOR`, and is the one number
 * in this file that is a *physical* default rather than a starting point: at a
 * fixed leaving temperature, zero bypass leaves the air saturated, which is
 * wetter than any real coil delivers. Ten percent puts it near 90% RH, where
 * coils are measured.
 */
export const DEFAULT_BYPASS_FACTOR = 0.1;

/** What the defaults read from, when there is anything to read. */
export interface ProcessDefaults {
  /** The resolved inlet, when it has resolved. */
  inlet?: StatePointOutput | null;
  /** Whether the document is in SI. */
  isSi?: boolean;
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
      // behind would draw a line from nowhere. `toId` is deliberately not
      // tested: a process's own outlet being deleted is handled by deleting the
      // process, and treating it as an input here would make the two orders of
      // that edit behave differently.
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
        qSensible: convertForUnits('power', p.qSensible, toSi),
        qLatent: convertForUnits('power', p.qLatent, toSi),
        targetW: convertForUnits('humidityRatio', p.targetW, toSi),
        steamEnthalpy: convertForUnits('enthalpy', p.steamEnthalpy, toSi),
        tAdp: convertForUnits('temperature', p.tAdp, toSi),
        wEquilibrium: convertForUnits('humidityRatio', p.wEquilibrium, toSi),
        // The effectivenesses and the bypass factor are ratios, and a ratio
        // carries across a unit switch untouched.
      })),
    })),
}));

/** Resets the id counter. Test-only; production ids are never reused. */
export function resetProcessIdCounter(): void {
  counter = 0;
}
