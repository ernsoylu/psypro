/**
 * The document as a graph: chaining, ordering, and what a deletion takes with it.
 *
 * These are the behaviours the rework exists for, and none of them are visible
 * in a component test. "Add a process from a point and get its outlet as a real
 * point" is one assertion; "delete the point in the middle of a train" has four
 * outcomes depending on what consumes what, and the interesting ones are the
 * two that are *not* "delete everything".
 *
 * The engine is mocked, and deliberately thinly: what is under test is the
 * shape of the graph and the order it resolves in, not the thermodynamics. A
 * process here simply adds ten degrees, which is enough to tell whether the
 * second process in a train started from the first one's outlet or from its
 * inlet.
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
  const ProcessFitKind = {
    SensibleHeating: 0,
    SensibleCooling: 1,
    Isothermal: 2,
    Evaporative: 3,
    CoolingDehumidification: 4,
    Desiccant: 5,
    General: 6,
  } as const;

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
  const take = (i: StatePointInput) => {
    if (i.consumed) throw new Error('null pointer passed to rust');
    i.consumed = true;
    return i;
  };
  const state = (dbt: number, w: number) => ({ dbt, humidity_ratio: w, enthalpy: dbt });
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
    ProcessFitKind,
    StatePointInput,
    calculate_state: (i: StatePointInput) => {
      const t = take(i);
      if (t.dbt > 500) throw new Error('state lies above saturation');
      return state(t.dbt, 0.009);
    },
    get_coordinate_mapping: (i: StatePointInput) => {
      const t = take(i);
      return { x: t.dbt, y: t.val2 };
    },
    // Ten degrees on, whatever was asked for: the outlet has to be
    // *distinguishable from the inlet* or a chain that silently restarts from
    // the wrong state would pass.
    apply_cooling: (i: StatePointInput) => {
      const t = take(i);
      return {
        process: {
          outlet: state(t.dbt + 10, t.val2),
          load: load(),
          near_saturation: false,
        },
        dehumidified: false,
        condensate: 0,
        frost_risk: false,
        coil: undefined,
      };
    },
    // Leaves the air at the surface plus the bypass share of the entering
    // spread, which is enough for the outlet to move when the mix feeding it
    // does — the property the cycle test is actually about.
    solve_coil_from_adp: (i: StatePointInput, tAdp: number, bf: number) => {
      const t = take(i);
      const leaving = tAdp + bf * (t.dbt - tAdp);
      return {
        leaving: state(leaving, 0.008),
        adp: state(tAdp, 0.0076),
        bf_temperature: bf,
        bf_humidity_ratio: bf,
        bf_enthalpy: bf,
        shr: 0.72,
        total_load: -30,
        air_side_load: -30.2,
        condensate: 0.0011,
        dry: false,
      };
    },
    // Flow-weighted, because that is what mixing *is* — and because a mock
    // that ignored the flows could not tell whether changing one moved the
    // train, which is the property the cycle test asserts.
    apply_mixing: (i: StatePointInput, ma: number, j: StatePointInput, mb: number) => {
      const a = take(i);
      const b = take(j);
      const total = ma + mb;
      return {
        outlet: state((ma * a.dbt + mb * b.dbt) / total, a.val2),
        mdot_da: total,
        fogged: false,
        condensate: 0,
      };
    },
    process_load: (i: StatePointInput, j: StatePointInput) => {
      take(i);
      take(j);
      return load();
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
  };
});

const {
  addProcessFrom,
  adoptFit,
  linkPoints,
  materialiseCycle,
  removePoint,
  removeProcess,
} = await import('./document');
const { resolveDocument } = await import('./useResolvedDocument');
const { usePsychStore, isDerived, producerOf, resetIdCounter } =
  await import('./usePsychStore');
const { useProcessStore, resetProcessIdCounter } = await import('./useProcessStore');
const { ChartLayout, InputState } = await import('../psychro');

const MESSAGES = {
  missingPoint: 'a point is missing',
  circular: 'this feeds its own inlet',
  unresolvedProcess: 'its process has not resolved',
};

const CTX = {
  isSi: true,
  altitude: 0,
  altitudeM: 0,
  realGas: true,
  layout: ChartLayout.Ashrae,
  messages: MESSAGES,
};

/** Resolves whatever is in the stores right now. */
function resolve() {
  return resolveDocument(
    usePsychStore.getState().points,
    useProcessStore.getState().processes,
    CTX,
  );
}

/** The document actions' context, backed by a fresh resolution. */
function actions() {
  const document = resolve();
  return {
    isSi: true,
    stateOf: (id: string) => document.pointsById.get(id)?.state ?? null,
  };
}

/** One typed point at 20 °C. */
function seed(label = 'OA', dryBulb = 20) {
  return usePsychStore.getState().addPoint({
    label,
    dryBulb,
    mode: InputState.DbtRh,
    secondValue: 50,
  });
}

beforeEach(() => {
  usePsychStore.getState().replaceAll([]);
  useProcessStore.getState().replaceAll([]);
  resetIdCounter();
  resetProcessIdCounter();
});

describe('adding a process', () => {
  it('creates its outlet as a real point', () => {
    const from = seed();
    const processId = addProcessFrom(from, 'sensible', actions());

    const process = useProcessStore.getState().processes.find((p) => p.id === processId);
    expect(process?.toId).toBeTruthy();

    const outlet = usePsychStore.getState().points.find((p) => p.id === process!.toId);
    // This is the whole request: the endpoint exists, is named, and knows what
    // put it there — so the next process can start from it.
    expect(outlet).toBeDefined();
    expect(isDerived(outlet!)).toBe(true);
    expect(producerOf(outlet!)).toBe(processId);
    expect(outlet!.label).not.toBe(usePsychStore.getState().points[0]!.label);
  });

  it('leaves the process selected, not the point it produced', () => {
    const from = seed();
    const processId = addProcessFrom(from, 'sensible', actions());
    // The gesture was "add a process"; the fields the user wants next are its
    // parameters, not the label of an outlet they did not ask for.
    expect(useProcessStore.getState().selectedId).toBe(processId);
    expect(usePsychStore.getState().selectedId).toBe(from);
  });

  it('takes its defaults from the inlet rather than from a constant', () => {
    // 35 °C outdoor air wants cooling. The old constant target of 30 asked to
    // cool it by five degrees and called the field "target dry bulb".
    const warm = seed('OA', 35);
    const id = addProcessFrom(warm, 'sensible', actions());
    const process = useProcessStore.getState().processes.find((p) => p.id === id);
    expect(process!.targetT).toBeCloseTo(25, 6);
    expect(process!.duty).toBeLessThan(0);

    const cool = seed('RA', 5);
    const heatingId = addProcessFrom(cool, 'sensible', actions());
    const heating = useProcessStore.getState().processes.find((p) => p.id === heatingId);
    expect(heating!.targetT).toBeCloseTo(15, 6);
    expect(heating!.duty).toBeGreaterThan(0);
  });

  it('does not create an outlet for a line between two existing points', () => {
    const a = seed('OA');
    const b = seed('RA', 24);
    const id = linkPoints(a, b, actions());
    const process = useProcessStore.getState().processes.find((p) => p.id === id);
    expect(process?.toId).toBeNull();
    expect(process?.secondId).toBe(b);
    expect(usePsychStore.getState().points).toHaveLength(2);
  });
});

describe('resolving a chain', () => {
  it('starts each process from the previous oness outlet', () => {
    const from = seed('OA', 20);
    const first = addProcessFrom(from, 'sensible', actions());
    const firstOutlet = useProcessStore
      .getState()
      .processes.find((p) => p.id === first)!.toId!;
    const second = addProcessFrom(firstOutlet, 'sensible', actions());

    const document = resolve();
    // 20 → 30 → 40. If the second process had re-resolved its inlet from stored
    // inputs it would have started at 20 again and landed at 30.
    expect(document.processesById.get(first)?.outlet?.dbt).toBeCloseTo(30, 6);
    expect(document.processesById.get(second)?.outlet?.dbt).toBeCloseTo(40, 6);
    expect(document.points.every((p) => p.error === null)).toBe(true);
  });

  it('resolves in dependency order however the processes are stored', () => {
    const from = seed('OA', 20);
    const first = addProcessFrom(from, 'sensible', actions());
    const outlet = useProcessStore
      .getState()
      .processes.find((p) => p.id === first)!.toId!;
    const second = addProcessFrom(outlet, 'sensible', actions());

    // Store them backwards: the downstream process comes first in the list, so
    // a resolver that walked the array once would find its inlet unresolved.
    const processes = useProcessStore.getState().processes;
    useProcessStore.getState().replaceAll([...processes].reverse());

    const document = resolve();
    expect(document.processesById.get(second)?.outlet?.dbt).toBeCloseTo(40, 6);
    expect(document.processesById.get(second)?.error).toBeNull();
  });

  it('reports a loop rather than hanging on it', () => {
    const a = seed('OA', 20);
    const first = addProcessFrom(a, 'sensible', actions());
    const outlet = useProcessStore
      .getState()
      .processes.find((p) => p.id === first)!.toId!;
    // Point the first process's inlet at its own outlet. A user re-plumbing a
    // train passes through exactly this state.
    useProcessStore.getState().updateProcess(first, { fromId: outlet });

    const document = resolve();
    expect(document.processesById.get(first)?.error).toBe(MESSAGES.circular);
    expect(document.pointsById.get(outlet)?.error).toBe(MESSAGES.circular);
  });

  it('hands a failed process s failure to the point it should have placed', () => {
    const from = usePsychStore.getState().addPoint({
      label: 'OA',
      // Above the mock's saturation guard, so the inlet itself does not resolve.
      dryBulb: 900,
      mode: InputState.DbtRh,
      secondValue: 50,
    });
    const id = addProcessFrom(from, 'sensible', actions());
    const outlet = useProcessStore.getState().processes.find((p) => p.id === id)!.toId!;

    const document = resolve();
    expect(document.pointsById.get(from)?.error).toMatch(/saturation/);
    // The outlet says why it is not on the chart, rather than being a marker
    // with no position and no explanation.
    expect(document.pointsById.get(outlet)?.error).toBe(MESSAGES.missingPoint);
  });

  it('resolves a mixing box, which is a tree rather than a sequence', () => {
    const oa = seed('OA', 30);
    const ra = seed('RA', 20);
    const id = addProcessFrom(oa, 'mix', actions());
    useProcessStore.getState().updateProcess(id, { secondId: ra });

    const document = resolve();
    // Equal flows by default, so the mix sits midway between 30 and 20.
    expect(document.processesById.get(id)?.outlet?.dbt).toBeCloseTo(25, 6);
  });
});

describe('deleting', () => {
  it('takes the train downstream of a deleted point', () => {
    const from = seed('OA');
    const first = addProcessFrom(from, 'sensible', actions());
    const outlet = useProcessStore
      .getState()
      .processes.find((p) => p.id === first)!.toId!;
    addProcessFrom(outlet, 'sensible', actions());
    expect(usePsychStore.getState().points).toHaveLength(3);

    removePoint(from);
    // Nothing downstream had another source, so leaving any of it behind would
    // draw a process from a state that no longer exists.
    expect(usePsychStore.getState().points).toHaveLength(0);
    expect(useProcessStore.getState().processes).toHaveLength(0);
  });

  it('detaches an outlet something downstream still consumes', () => {
    const from = seed('OA', 20);
    const first = addProcessFrom(from, 'sensible', actions());
    const outlet = useProcessStore
      .getState()
      .processes.find((p) => p.id === first)!.toId!;
    const second = addProcessFrom(outlet, 'sensible', actions());

    removeProcess(first, actions());

    // The coil is gone; the state it produced survives as a typed point, so the
    // rest of the train still resolves. Collapsing it instead would delete a
    // coil and take the supply air with it.
    const kept = usePsychStore.getState().points.find((p) => p.id === outlet);
    expect(kept).toBeDefined();
    expect(isDerived(kept!)).toBe(false);
    expect(kept!.dryBulb).toBeCloseTo(30, 6);
    expect(kept!.mode).toBe(InputState.DbtHumidityRatio);

    const document = resolve();
    expect(document.processesById.get(second)?.outlet?.dbt).toBeCloseTo(40, 6);
  });

  it('removes an outlet nothing consumes along with its process', () => {
    const from = seed('OA');
    const id = addProcessFrom(from, 'sensible', actions());
    expect(usePsychStore.getState().points).toHaveLength(2);

    removeProcess(id, actions());
    expect(usePsychStore.getState().points).toHaveLength(1);
    expect(usePsychStore.getState().points[0]!.id).toBe(from);
  });
});

describe('adopting a fit', () => {
  it('makes the endpoint the process s own outlet', () => {
    const a = seed('OA', 20);
    const b = seed('SA', 30);
    const id = linkPoints(a, b, actions());

    expect(adoptFit(id, 'sensible', { targetT: 30 })).toBe(true);

    const process = useProcessStore.getState().processes.find((p) => p.id === id)!;
    expect(process.kind).toBe('sensible');
    expect(process.toId).toBe(b);
    expect(process.secondId).toBeNull();
    // The point that was typed is now placed by the process, which is what
    // makes the adopted process editable: change the target and the endpoint
    // follows.
    expect(producerOf(usePsychStore.getState().points.find((p) => p.id === b)!)).toBe(id);
  });

  it('refuses when the endpoint already has a producer', () => {
    const a = seed('OA', 20);
    const first = addProcessFrom(a, 'sensible', actions());
    const outlet = useProcessStore
      .getState()
      .processes.find((p) => p.id === first)!.toId!;
    const link = linkPoints(a, outlet, actions());

    // Adopting would give one point two producers, and the second would silently
    // win on every resolution.
    expect(adoptFit(link, 'sensible', { targetT: 30 })).toBe(false);
  });
});

describe('putting a solved cycle on the chart', () => {
  const CYCLE = {
    outdoor: { dryBulb: 35, mode: InputState.DbtRh, secondValue: 40 },
    room: { dryBulb: 24, mode: InputState.DbtRh, secondValue: 50 },
    adp: 10.2,
    bypassFactor: 0.1739,
    mdotOutdoor: 0.354,
    mdotSupply: 1.772,
    outdoorLabel: 'Outdoor air',
    roomLabel: 'Room',
    mixedLabel: 'Mixing',
    supplyLabel: 'Supply fan',
  };

  it('lands as an ordinary document: five states, two processes, all editable', () => {
    seed('stale');
    materialiseCycle(CYCLE, actions());

    const points = usePsychStore.getState().points;
    const processes = useProcessStore.getState().processes;
    // Two typed boundary conditions and two derived outlets. The stale point is
    // gone: this replaces the document rather than merging into it, because
    // every merge rule for an existing point labelled OA is a surprise.
    expect(points.map((p) => p.label)).toEqual([
      'Outdoor air',
      'Room',
      'Mixing',
      'Supply fan',
    ]);
    expect(points.filter(isDerived)).toHaveLength(2);
    expect(processes.map((p) => p.kind)).toEqual(['mix', 'cooling']);
  });

  it('stores the boundary conditions as the case states them', () => {
    materialiseCycle(CYCLE, actions());
    const oa = usePsychStore.getState().points[0]!;
    // Dry bulb and relative humidity, which is what was typed. Storing a
    // humidity ratio derived from them would put a stale reading in the
    // document the first time the elevation changed.
    expect(oa.mode).toBe(InputState.DbtRh);
    expect(oa.dryBulb).toBe(35);
    expect(oa.secondValue).toBe(40);
  });

  it('keeps the cycle alive: the coil follows the mix it is fed', () => {
    materialiseCycle(CYCLE, actions());
    const [mix, coil] = useProcessStore.getState().processes;

    // The coil's inlet is the mix's outlet, not a copy of the mixed state. That
    // is what makes changing the outdoor-air flow move the whole train, and it
    // is what three frozen `link` lines could not do.
    expect(coil!.fromId).toBe(mix!.toId);
    expect(coil!.tAdp).toBeCloseTo(10.2, 6);
    expect(coil!.bypassFactor).toBeCloseTo(0.1739, 6);
    expect(mix!.mdot).toBeCloseTo(0.354, 6);
    expect(mix!.mdotSecond).toBeCloseTo(1.772 - 0.354, 6);

    const before = resolve().processesById.get(coil!.id)?.outlet?.dbt;
    useProcessStore.getState().updateProcess(mix!.id, { mdot: 1.6, mdotSecond: 0.17 });
    const after = resolve().processesById.get(coil!.id)?.outlet?.dbt;
    expect(after).not.toBe(before);
  });
});
