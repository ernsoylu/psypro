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
  const coil = () => ({
    leaving: state(12, 0.008),
    adp: state(10, 0.0076),
    bf_temperature: 0.1,
    bf_humidity_ratio: 0.1,
    bf_enthalpy: 0.1,
    shr: 0.72,
    total_load: -30,
    air_side_load: -30.2,
    condensate: 0.0011,
    dry: false,
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
    apply_cooling: (i: StatePointInput, tOut: number) => {
      take(i);
      return {
        process: { outlet: state(tOut, 0.009), load: load(), near_saturation: false },
        dehumidified: false,
        condensate: 0,
        frost_risk: false,
        coil: undefined,
      };
    },
    apply_cooling_duty: (i: StatePointInput) => {
      take(i);
      return {
        process: { outlet: state(15, 0.008), load: load(), near_saturation: false },
        dehumidified: true,
        condensate: 0.0011,
        frost_risk: false,
        coil: coil(),
      };
    },
    apply_desiccant: (i: StatePointInput) => {
      take(i);
      return { outlet: state(38, 0.004), load: load(), near_saturation: false };
    },
    solve_coil_from_adp: (i: StatePointInput) => {
      take(i);
      return coil();
    },
    identify_process: (i: StatePointInput, j: StatePointInput) => {
      take(i);
      take(j);
      return {
        kind: 0,
        load: load(),
        slope: Number.NaN,
        has_slope: false,
        duty: 10,
        has_duty: true,
        water_flow: Number.NaN,
        has_water_flow: false,
        steam_enthalpy: Number.NaN,
        has_steam_enthalpy: false,
        effectiveness: Number.NaN,
        has_effectiveness: false,
        enthalpy_rise: Number.NaN,
        has_enthalpy_rise: false,
      };
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
const { ChartLayout } = await import('../psychro');
type StatePointOutput = import('../psychro').StatePointOutput;

/**
 * Resolved *states*, not stored points.
 *
 * The resolver takes what the document already worked out, because an inlet may
 * itself be the outlet of an earlier process and then has no stored inputs to
 * re-resolve.
 */
const STATES = new Map([
  ['pt-1', { dbt: 20, humidity_ratio: 0.0073, enthalpy: 38.6 }],
  ['pt-2', { dbt: 24, humidity_ratio: 0.0074, enthalpy: 43.0 }],
  // Cast because the mocked module is typed as the real one: a full
  // `StatePointOutput` carries twelve properties and a `free()`, and the
  // resolver reads three of them.
] as [string, unknown][]) as Map<string, StatePointOutput>;

const CTX = {
  isSi: true,
  altitude: 0,
  altitudeM: 0,
  realGas: true,
  layout: ChartLayout.Ashrae,
  stateOf: (id: string) => STATES.get(id) ?? null,
  positionOf: (id: string) => (STATES.has(id) ? { x: 1, y: 2 } : null),
  missingPointMessage: 'a point is missing',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('every process kind resolves without reusing a consumed input', () => {
  for (const kind of [
    'sensible',
    'sensibleDuty',
    'cooling',
    'steam',
    'evaporative',
    'desiccant',
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

  it('identifies the line a link draws, rather than only costing it', () => {
    // The reason the kind exists at all: a load alone does not say what the
    // line *is*, and the parameters are what let it be adopted.
    const p = { ...defaultProcess('link', 'pt-1'), id: 'pr-1', secondId: 'pt-2' };
    expect(resolveProcess(p, CTX).fit?.has_duty).toBe(true);
  });

  it('carries a wet coil through as a result rather than an error', () => {
    // The reported bug: a target below the entering dew point used to come back
    // as the backend's supersaturation message.
    const p = { ...defaultProcess('sensibleDuty', 'pt-1'), id: 'pr-1', secondId: null };
    const r = resolveProcess(p, CTX);
    expect(r.error).toBeNull();
    expect(r.dehumidified).toBe(true);
    expect(r.condensate).toBeCloseTo(0.0011, 9);
    expect(r.coil?.adp.dbt).toBeCloseTo(10, 6);
  });
});
