/**
 * The document as one dependency graph, resolved in order.
 *
 * Points and processes used to resolve independently — every point from its own
 * two numbers, every process from its own inlet's two numbers — which is why a
 * process could never place a point. Admitting derived points ends that: an
 * inlet may be the outlet of an earlier process, so *nothing* can be resolved
 * before the thing it depends on.
 *
 * So the two resolvers merge here. Anchored points resolve first; processes
 * resolve as their inputs become available, each filling in the point it places;
 * and what is left over at the end is a cycle, reported as one.
 *
 * # Why a graph rather than a list with an order field
 *
 * Because mixing has two inlets. A document with an outdoor-air stream and a
 * return-air stream joining at a mixing box is a *tree*, not a sequence, and any
 * "process 3 comes after process 2" ordering has to lie about one of the two
 * branches. The graph is also what makes deleting a point in the middle of a
 * train a well-defined edit rather than a renumbering.
 *
 * The walk is O(n²) in the worst case and n is the number of processes in one
 * document — tens, not thousands. A topological pre-sort would be asymptotically
 * better and materially harder to read, and this runs inside a `useMemo` keyed
 * on the graph.
 */

import { useMemo } from 'react';

import type { StatePointOutput } from '../psychro';
import { producerOf, type StatePoint } from './usePsychStore';
import { needsSecondPoint, type Process } from './useProcessStore';
import {
  resolvePoint,
  type ChartPosition,
  type ResolveContext,
  type ResolvedPoint,
} from './useResolvedPoints';
import {
  failedProcess,
  resolveProcess,
  type ResolvedProcess,
} from './useResolvedProcesses';

/** Everything the chart, the panel and the exporters read. */
export interface ResolvedDocument {
  /** Every point, in document order. */
  points: ResolvedPoint[];
  /** Every process, in document order. */
  processes: ResolvedProcess[];
  /** The same points, by id. */
  pointsById: Map<string, ResolvedPoint>;
  /** The same processes, by id. */
  processesById: Map<string, ResolvedProcess>;
}

/** The messages the resolver needs, translated by the caller. */
export interface DocumentMessages {
  /** A process endpoint that is gone or did not resolve. */
  missingPoint: string;
  /** A process whose outlet feeds, eventually, its own inlet. */
  circular: string;
  /** A derived point whose process has not resolved. */
  unresolvedProcess: string;
}

/** What the document resolution needs. */
export interface DocumentContext extends ResolveContext {
  /** Elevation as the document expresses it. */
  altitude: number;
  /**
   * Translated failure messages.
   *
   * Memoise this at the call site. It is in the hook's dependency list, and a
   * fresh object literal every render would re-resolve the whole document on
   * every render — which is exactly the churn the 60 FPS drag path cannot pay.
   */
  messages: DocumentMessages;
}

/** The points a process consumes — one, or two for the joining kinds. */
function inputsOf(process: Process): string[] {
  return needsSecondPoint(process.kind) && process.secondId
    ? [process.fromId, process.secondId]
    : [process.fromId];
}

/**
 * Resolves a whole document.
 *
 * Pure, and deliberately not a hook, so the graph walk can be tested headlessly
 * against the real engine without mounting a component.
 */
export function resolveDocument(
  points: readonly StatePoint[],
  processes: readonly Process[],
  ctx: DocumentContext,
): ResolvedDocument {
  const state = new Map<string, StatePointOutput>();
  const position = new Map<string, ChartPosition>();
  const resolvedPoints = new Map<string, ResolvedPoint>();
  const resolvedProcesses = new Map<string, ResolvedProcess>();

  const record = (point: ResolvedPoint) => {
    resolvedPoints.set(point.point.id, point);
    if (point.state) state.set(point.point.id, point.state);
    if (point.position) position.set(point.point.id, point.position);
  };

  // 1. The points the user typed. Independent of everything, so they go first
  //    and they are the only place a document can begin.
  for (const point of points) {
    if (producerOf(point) === null) record(resolvePoint(point, ctx));
  }

  const processContext = {
    ...ctx,
    stateOf: (id: string) => state.get(id) ?? null,
    positionOf: (id: string) => position.get(id) ?? null,
    missingPointMessage: ctx.messages.missingPoint,
  };

  const byId = new Map(points.map((p) => [p.id, p]));
  /** A derived point that failed, so the reason travels to whatever reads it. */
  const failPoint = (id: string, error: string) => {
    const point = byId.get(id);
    if (point) resolvedPoints.set(id, { point, state: null, position: null, error });
  };

  // 2. Processes, as their inputs arrive. A pass that resolves nothing means
  //    everything left is waiting on something that will never come.
  const pending = new Set(processes.map((p) => p.id));
  let progressed = true;
  while (progressed && pending.size > 0) {
    progressed = false;

    for (const process of processes) {
      if (!pending.has(process.id)) continue;

      const inputs = inputsOf(process);
      // Still waiting: an input point exists but its own producer has not run.
      // Not an error — this is exactly what the ordering is for.
      const waiting = inputs.some(
        (id) =>
          !resolvedPoints.has(id) && byId.has(id) && producerOf(byId.get(id)!) !== null,
      );
      if (waiting) continue;

      const resolved = resolveProcess(process, processContext);
      resolvedProcesses.set(process.id, resolved);
      pending.delete(process.id);
      progressed = true;

      // The point this process places, filled in from what came back. A
      // process that failed hands its outlet the same failure, so the panel
      // says why the point is missing rather than showing an empty marker.
      if (process.toId) {
        if (resolved.outlet && resolved.to) {
          const point = byId.get(process.toId);
          if (point) {
            record({
              point,
              state: resolved.outlet,
              position: resolved.to,
              error: null,
            });
          }
        } else {
          failPoint(process.toId, resolved.error ?? ctx.messages.unresolvedProcess);
        }
      }
    }
  }

  // 3. Whatever is left is a cycle: A feeds B feeds A, so neither input ever
  //    arrives. Reported on the processes rather than thrown, because a user
  //    halfway through re-plumbing a train will pass through this state.
  for (const id of pending) {
    const process = processes.find((p) => p.id === id);
    if (!process) continue;
    resolvedProcesses.set(id, failedProcess(process, ctx.messages.circular));
    if (process.toId) failPoint(process.toId, ctx.messages.circular);
  }

  // 4. A derived point whose process was deleted outright has nothing to place
  //    it. Ordinarily impossible — the document actions remove the two together
  //    — but a hand-edited project file can carry it, and a point that renders
  //    as nothing with no explanation is the worse outcome.
  for (const point of points) {
    if (!resolvedPoints.has(point.id)) {
      failPoint(point.id, ctx.messages.unresolvedProcess);
    }
  }

  return {
    points: points.map((p) => resolvedPoints.get(p.id)!),
    processes: processes.flatMap((p) => {
      const resolved = resolvedProcesses.get(p.id);
      return resolved ? [resolved] : [];
    }),
    pointsById: resolvedPoints,
    processesById: resolvedProcesses,
  };
}

/**
 * Resolves the document, memoised on the graph and the settings that invalidate
 * it.
 *
 * The dependency list is the physics and the document shape, and nothing else:
 * a re-render caused by opening a modal costs nothing, while a change of
 * elevation correctly re-resolves the lot.
 */
export function useResolvedDocument(
  points: StatePoint[],
  processes: Process[],
  ctx: DocumentContext,
): ResolvedDocument {
  const { isSi, altitude, altitudeM, realGas, layout, messages } = ctx;
  return useMemo(
    () =>
      resolveDocument(points, processes, {
        isSi,
        altitude,
        altitudeM,
        realGas,
        layout,
        messages,
      }),
    [points, processes, isSi, altitude, altitudeM, realGas, layout, messages],
  );
}
