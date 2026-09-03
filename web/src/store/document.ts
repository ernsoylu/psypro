/**
 * Edits that touch more than one store.
 *
 * Adding a process now creates a point, and deleting a point now deletes
 * processes — so these operations cannot live inside either store without one
 * reaching into the other. They are plain functions over `getState()` rather
 * than a fourth store, because they hold no state of their own: they are the
 * *transactions* of the document, and putting them here keeps `App` free of
 * multi-step edits it would otherwise have to sequence correctly every time.
 *
 * Being plain functions also means they are tested headlessly, which matters
 * more here than anywhere else in the state layer: "delete the point in the
 * middle of a train" has four outcomes depending on what consumes what, and
 * none of them are visible in a component test.
 */

import type { StatePointOutput } from '../psychro';
import { InputState } from '../psychro';
import {
  defaultProcess,
  derivesOutlet,
  useProcessStore,
  type Process,
  type ProcessKind,
} from './useProcessStore';
import { nextLabel, producerOf, usePsychStore, TYPED } from './usePsychStore';

/** What a document edit needs to know beyond the stores themselves. */
export interface DocumentActionContext {
  /** Whether the document is in SI, so defaults land in its own units. */
  isSi: boolean;
  /**
   * The resolved state of a point.
   *
   * Needed for the snapshot a *detach* writes: promoting a derived point to a
   * typed one has to put it where it currently is, and only the resolution
   * knows that.
   */
  stateOf: (id: string) => StatePointOutput | null;
}

/** The dormant anchor a point falls back to, taken from a resolved state. */
function anchorFrom(state: StatePointOutput) {
  return {
    dryBulb: state.dbt,
    mode: InputState.DbtHumidityRatio,
    secondValue: state.humidity_ratio,
  };
}

/**
 * Adds a process from a point, and the point it lands on.
 *
 * This is the change the whole rework exists for. The outlet is a real point
 * with a real id, so the next process can start from it — which is how a train
 * gets built, one process at a time, without the user computing an intermediate
 * state by hand and typing it back in.
 *
 * Returns the new process's id. The process, not the point, is selected
 * afterwards: the gesture was "add a process", and the fields the user wants
 * next are its parameters.
 */
export function addProcessFrom(
  fromId: string,
  kind: ProcessKind,
  ctx: DocumentActionContext,
): string {
  const points = usePsychStore.getState();
  const processes = useProcessStore.getState();
  const inlet = ctx.stateOf(fromId);

  const processId = processes.addProcess(
    defaultProcess(kind, fromId, { inlet, isSi: ctx.isSi }),
  );

  if (derivesOutlet(kind)) {
    const stored = points.points.find((p) => p.id === fromId);
    const outletId = points.addOutletPoint(
      processId,
      nextLabel(usePsychStore.getState().points),
      // Seeded from the inlet, so a detached outlet lands somewhere physical
      // even if it is detached before the process has ever resolved.
      inlet
        ? anchorFrom(inlet)
        : {
            dryBulb: stored?.dryBulb ?? (ctx.isSi ? 24 : 75),
            mode: stored?.mode ?? InputState.DbtRh,
            secondValue: stored?.secondValue ?? 50,
          },
    );
    useProcessStore.getState().updateProcess(processId, { toId: outletId });
  }

  return processId;
}

/** Whether any process other than `exceptId` consumes this point. */
function isConsumed(pointId: string, exceptId: string, processes: Process[]): boolean {
  return processes.some(
    (p) => p.id !== exceptId && (p.fromId === pointId || p.secondId === pointId),
  );
}

/**
 * Deletes a process, and decides what becomes of the point it placed.
 *
 * Three outcomes, and the middle one is the one worth having:
 *
 * * Nothing consumed the outlet → the point goes with the process.
 * * Something downstream consumed it → the point is **detached**, keeping the
 *   state it had, so the rest of the train survives the edit. Collapsing it
 *   instead would delete a coil and take the supply air with it.
 * * The process placed no point at all (`link`) → nothing to decide.
 */
export function removeProcess(id: string, ctx: DocumentActionContext): void {
  const processes = useProcessStore.getState();
  const process = processes.processes.find((p) => p.id === id);
  if (!process) return;

  if (process.toId) {
    const outletId = process.toId;
    if (isConsumed(outletId, id, processes.processes)) {
      const state = ctx.stateOf(outletId);
      const points = usePsychStore.getState();
      const stored = points.points.find((p) => p.id === outletId);
      points.detachPoint(
        outletId,
        state
          ? anchorFrom(state)
          : {
              dryBulb: stored?.dryBulb ?? (ctx.isSi ? 24 : 75),
              mode: stored?.mode ?? InputState.DbtRh,
              secondValue: stored?.secondValue ?? 50,
            },
      );
    } else {
      usePsychStore.getState().removeOutletsOf(id);
    }
  }

  useProcessStore.getState().removeProcess(id);
}

/**
 * Deletes a point, and everything that cannot exist without it.
 *
 * A process whose inlet is gone is not a process, and the outlet that process
 * placed is not a state — so the deletion walks *forward* along the graph. A
 * typed point in the middle of a train therefore takes the downstream train
 * with it, which is the truthful outcome: nothing downstream had any other
 * source.
 */
export function removePoint(id: string): void {
  const seen = new Set<string>();

  const walk = (pointId: string) => {
    if (seen.has(pointId)) return;
    seen.add(pointId);

    // Snapshot the consumers before mutating: the list shortens as we go, and
    // iterating a live store list while deleting from it skips entries.
    const consumers = useProcessStore
      .getState()
      .processes.filter((p) => p.fromId === pointId || p.secondId === pointId);

    for (const process of consumers) {
      const outletId = process.toId;
      useProcessStore.getState().removeProcess(process.id);
      if (outletId) walk(outletId);
    }

    usePsychStore.getState().removePoint(pointId);
  };

  walk(id);
}

/**
 * Joins two points that already exist, and lets the engine say what the line
 * between them *is*.
 *
 * The other half of the authoring story: the forward direction states
 * parameters and derives an outlet, this one states two states and derives the
 * parameters. Both end up as a process in the same document.
 */
export function linkPoints(
  fromId: string,
  toId: string,
  ctx: DocumentActionContext,
): string {
  return useProcessStore.getState().addProcess({
    ...defaultProcess('link', fromId, {
      inlet: ctx.stateOf(fromId),
      isSi: ctx.isSi,
    }),
    secondId: toId,
  });
}

/**
 * Turns a fitted line into the parametric process it was identified as.
 *
 * A fit is read-only by nature — it describes two points that already exist. A
 * *parametric* process owns its outlet, so converting one adopts the back-solved
 * parameters and makes the second point that process's derived outlet. That is
 * what stops "identify the process between these two points" being a dead end:
 * afterwards the process can be edited, and the endpoint follows.
 *
 * Returns false when the fit's endpoint is already placed by something else, in
 * which case adopting it would give one point two producers.
 */
export function adoptFit(
  processId: string,
  kind: ProcessKind,
  parameters: Partial<Process>,
): boolean {
  const processes = useProcessStore.getState();
  const process = processes.processes.find((p) => p.id === processId);
  if (!process?.secondId) return false;

  const endpoint = usePsychStore.getState().points.find((p) => p.id === process.secondId);
  if (!endpoint || producerOf(endpoint) !== null) return false;

  processes.updateProcess(processId, {
    ...parameters,
    kind,
    toId: process.secondId,
    secondId: null,
  });
  usePsychStore.getState().updatePoint(endpoint.id, {
    source: { kind: 'outlet', processId },
  });
  return true;
}

/** Every point a train reaches from here, following the graph forward. */
export function downstreamOf(
  pointId: string,
  processes: readonly Process[],
): Set<string> {
  const reached = new Set<string>();
  const frontier = [pointId];
  while (frontier.length > 0) {
    const current = frontier.pop()!;
    for (const process of processes) {
      if (process.fromId !== current && process.secondId !== current) continue;
      if (!process.toId || reached.has(process.toId)) continue;
      reached.add(process.toId);
      frontier.push(process.toId);
    }
  }
  return reached;
}

/**
 * Materialises a solved cycle as real points and processes.
 *
 * The Process Design page was an island: eight numbers in, a read-only results
 * strip out, and nothing crossing in either direction. Its OA/RA/MA/CL states
 * never became points, so the chart never drew the cycle the page had just
 * solved and no part of it could be edited.
 *
 * This is the crossing. The macro's answer becomes an ordinary document — five
 * points and three processes — which is then draggable, editable, exportable and
 * drawn on the chart like anything else. Nothing about it is special afterwards,
 * which is the point: the page becomes a *way to start* a document rather than a
 * separate calculator.
 *
 * The cycle is expressed as **parametric processes rather than fitted lines**,
 * so it stays alive: change the outdoor-air fraction on the mixing process and
 * the mixed state moves, and the coil follows it. Laying it down as three
 * `link` lines would reproduce the same picture and freeze it.
 *
 * Replaces the document rather than adding to it. Merging would need a rule for
 * what to do about an existing point labelled OA that means something else, and
 * every rule for that is a surprise; "this replaces your document" is at least
 * a sentence a confirmation dialog can say.
 */
export function materialiseCycle(cycle: CycleSnapshot, ctx: DocumentActionContext): void {
  const points = usePsychStore.getState();
  const processes = useProcessStore.getState();
  points.replaceAll([]);
  processes.replaceAll([]);

  const anchored = (label: string, inputs: BoundaryInputs) =>
    usePsychStore.getState().addPoint({ label, ...inputs, source: TYPED });

  // The two boundary conditions go in as **the inputs the design case states**,
  // not as states resolved from them. That is the same rule the rest of the
  // document follows, and here it has teeth: the case is typed as dry bulb and
  // relative humidity, so re-deriving a humidity ratio to store instead would
  // put a stale reading in the document the first time the elevation changed.
  const oa = anchored(cycle.outdoorLabel, cycle.outdoor);
  const ra = anchored(cycle.roomLabel, cycle.room);

  // Mixing: outdoor air against return air, at the flows the macro solved.
  const mix = addProcessFrom(oa, 'mix', ctx);
  useProcessStore.getState().updateProcess(mix, {
    secondId: ra,
    mdot: cycle.mdotOutdoor,
    mdotSecond: cycle.mdotSupply - cycle.mdotOutdoor,
  });
  const mixOutlet = useProcessStore.getState().processes.find((p) => p.id === mix)?.toId;
  if (mixOutlet)
    usePsychStore.getState().updatePoint(mixOutlet, { label: cycle.mixedLabel });

  // The coil, stated as the apparatus dew point and bypass factor the macro
  // found — the form a designer selects equipment in, and the form that keeps
  // the leaving state derived rather than stored.
  if (!mixOutlet) return;
  const coil = addProcessFrom(mixOutlet, 'cooling', ctx);
  useProcessStore.getState().updateProcess(coil, {
    mdot: cycle.mdotSupply,
    tAdp: cycle.adp,
    bypassFactor: cycle.bypassFactor,
  });
  const coilOutlet = useProcessStore
    .getState()
    .processes.find((p) => p.id === coil)?.toId;
  if (coilOutlet) {
    usePsychStore.getState().updatePoint(coilOutlet, { label: cycle.supplyLabel });
  }

  usePsychStore.getState().selectPoint(oa);
}

/** One boundary condition, as the design case states it. */
export interface BoundaryInputs {
  /** Dry-bulb temperature, in the document's units. */
  dryBulb: number;
  /** Which second property is given. */
  mode: InputState;
  /** The second property's value. */
  secondValue: number;
}

/** The cycle, reduced to what a document needs from it. */
export interface CycleSnapshot {
  /** The design outdoor condition, as typed. */
  outdoor: BoundaryInputs;
  /** The design room condition, as typed. */
  room: BoundaryInputs;
  /** The coil's apparatus dew point, in the document's units. */
  adp: number;
  /** The coil's bypass factor, read on humidity ratio. */
  bypassFactor: number;
  /** Outdoor-air dry-air mass flow. */
  mdotOutdoor: number;
  /** Total supply dry-air mass flow. */
  mdotSupply: number;
  /** The labels, translated by the caller so no English reaches the store. */
  outdoorLabel: string;
  roomLabel: string;
  mixedLabel: string;
  supplyLabel: string;
}
