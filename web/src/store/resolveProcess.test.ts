/**
 * Process resolution, and the wasm-bindgen ownership trap it fell into.
 *
 * `wasm-bindgen` **moves** a `StatePointInput` into Rust when it is passed. The
 * JavaScript wrapper is dead afterwards, and using it a second time fails with
 * "null pointer passed to rust" — which is what the process panel showed the
 * first time it ran, because a process needs its inlet twice: once to resolve
 * the outlet and once to position the arrow's tail.
 *
 * The mock below reproduces that ownership rule rather than ignoring it, so this
 * suite fails the way the browser did. A mock that let a consumed input be
 * reused would have passed the broken code.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../psychro', () => {
  const InputState = {
    DbtWbt: 0,
    DbtRh: 1,
    DbtDewPoint: 2,
    DbtHumidityRatio: 3,
    DbtEnthalpy: 4,
  } as const;
  const ChartLayout = { Ashrae: 0, MollierIx: 1 } as const;

  /** A wrapper that dies when it is passed to Rust, exactly as the real one does. */
  class StatePointInput {
    consumed = false;
    constructor(
      public dbt: number,
      public val2: number,
      public state_type: number,
      public altitude: number,
      public is_si: boolean,
      public real_gas: boolean,
    ) {}
  }
  const take = (input: StatePointInput) => {
    if (input.consumed) throw new Error('null pointer passed to rust');
    input.consumed = true;
    return input;
  };

  const state = (dbt: number, w: number) => ({
    dbt,
    humidity_ratio: w,
    enthalpy: 1.006 * dbt + w * (2499.86 + 1.84 * dbt),
  });
  const load = () => ({
    total: 10,
    sensible: 10,
    latent: 0,
    moisture: 0,
    shr: 1,
    has_shr: true,
  });

  return {
    InputState,
    ChartLayout,
    StatePointInput,
    get_coordinate_mapping: (i: StatePointInput) => {
      const t = take(i);
      return { x: t.dbt, y: t.val2 };
    },
    apply_sensible: (i: StatePointInput, tOut: number) => {
      take(i);
      return { outlet: state(tOut, 0.009), load: load(), near_saturation: false };
    },
    apply_sensible_duty: (i: StatePointInput) => {
      take(i);
      return { outlet: state(30, 0.009), load: load(), near_saturation: false };
    },
    apply_steam_humidification: (i: StatePointInput, w: number) => {
      take(i);
      return {
        process: { outlet: state(20, w), load: load(), near_saturation: false },
        steam_flow: 0.004,
      };
    },
    apply_evaporative: (i: StatePointInput) => {
      take(i);
      return { outlet: state(22, 0.012), load: load(), near_saturation: true };
    },
    apply_energy_recovery: (i: StatePointInput, j: StatePointInput) => {
      take(i);
      take(j);
      return { outlet: state(12, 0.005), load: load(), near_saturation: false };
    },
    apply_mixing: (i: StatePointInput, _ma: number, j: StatePointInput) => {
      take(i);
      take(j);
      return { outlet: state(18, 0.008), mdot_da: 2, fogged: true, condensate: 0.0003 };
    },
    process_load: (i: StatePointInput, j: StatePointInput) => {
      take(i);
      take(j);
      return load();
    },
  };
});

const { resolveProcess } = await import('./useResolvedProcesses');
const { defaultProcess } = await import('./useProcessStore');
const { ChartLayout, InputState } = await import('../psychro');

const POINTS = new Map([
  ['pt-1', { id: 'pt-1', label: 'OA', dryBulb: 20, mode: InputState.DbtRh, secondValue: 50 }],
  ['pt-2', { id: 'pt-2', label: 'RA', dryBulb: 24, mode: InputState.DbtRh, secondValue: 40 }],
]);

const CTX = {
  isSi: true,
  altitude: 0,
  altitudeM: 0,
  realGas: true,
  layout: ChartLayout.Ashrae,
  points: POINTS,
  missingPointMessage: 'a point is missing',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('every process kind resolves without reusing a consumed input', () => {
  for (const kind of [
    'sensible',
    'sensibleDuty',
    'steam',
    'evaporative',
    'recovery',
    'mix',
    'link',
  ] as const) {
    it(kind, () => {
      const process = { ...defaultProcess(kind, 'pt-1'), id: 'pr-1', secondId: 'pt-2' };
      const r = resolveProcess(process, CTX);
      // The bug this guards against surfaced as an error string, not a throw,
      // because resolveProcess catches — so the assertion is on the error.
      expect(r.error).toBeNull();
      expect(r.from).not.toBeNull();
      expect(r.to).not.toBeNull();
      expect(r.load).not.toBeNull();
    });
  }
});

describe('process resolution', () => {
  it('reports a missing endpoint rather than throwing', () => {
    // Deleting a point while a process refers to it is a normal edit, and the
    // panel needs to say what happened rather than go blank.
    const orphan = { ...defaultProcess('sensible', 'gone'), id: 'pr-1', secondId: null };
    expect(resolveProcess(orphan, CTX).error).toBe('a point is missing');
  });

  it('reports a missing second stream for the kinds that need one', () => {
    for (const kind of ['mix', 'recovery', 'link'] as const) {
      const p = { ...defaultProcess(kind, 'pt-1'), id: 'pr-1', secondId: null };
      expect(resolveProcess(p, CTX).error).toBe('a point is missing');
    }
  });

  it('carries the fogging flag and the condensate through a mix', () => {
    const p = { ...defaultProcess('mix', 'pt-1'), id: 'pr-1', secondId: 'pt-2' };
    const r = resolveProcess(p, CTX);
    expect(r.fogged).toBe(true);
    expect(r.condensate).toBeCloseTo(0.0003, 9);
  });

  it('carries the near-saturation warning through', () => {
    const p = { ...defaultProcess('evaporative', 'pt-1'), id: 'pr-1', secondId: null };
    expect(resolveProcess(p, CTX).nearSaturation).toBe(true);
  });

  it('has no outlet for a line between two points that already exist', () => {
    // A `link` reports what the line costs; it does not create a new state.
    const p = { ...defaultProcess('link', 'pt-1'), id: 'pr-1', secondId: 'pt-2' };
    const r = resolveProcess(p, CTX);
    expect(r.outlet).toBeNull();
    expect(r.load).not.toBeNull();
  });
});
