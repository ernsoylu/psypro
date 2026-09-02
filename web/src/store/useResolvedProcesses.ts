/**
 * Stored process definitions → resolved outlets, loads and chart geometry.
 *
 * The same shape as `useResolvedPoints`, for the same reason: a process holds
 * what it *does*, and everything it produces is derived. Change the elevation
 * and every outlet moves, because the physics moved.
 *
 * Every number here comes from a WASM call. The load decomposition in
 * particular is done in Rust rather than here, so the SHR shown in the panel and
 * the protractor drawn on the chart come from one place and cannot disagree.
 */

import { useMemo } from 'react';

import {
  apply_energy_recovery,
  apply_evaporative,
  apply_mixing,
  apply_sensible,
  apply_sensible_duty,
  apply_steam_humidification,
  get_coordinate_mapping,
  process_load,
  InputState,
  StatePointInput,
  type LoadOutput,
  type StatePointOutput,
} from '../psychro';
import type { Process } from './useProcessStore';
import type { ResolveContext } from './useResolvedPoints';
import type { StatePoint } from './usePsychStore';

/** A process with everything the chart and the panel need. */
export interface ResolvedProcess {
  /** The stored definition this came from. */
  process: Process;
  /** Chart-space start, or null if the inlet did not resolve. */
  from: { x: number; y: number } | null;
  /** Chart-space end, or null if the outlet did not resolve. */
  to: { x: number; y: number } | null;
  /** The state the air leaves in. */
  outlet: StatePointOutput | null;
  /** What the process moved. */
  load: LoadOutput | null;
  /** Whether the outlet is close enough to saturation to need a second look. */
  nearSaturation: boolean;
  /** Whether a mix fogged and dropped water out. */
  fogged: boolean;
  /** Water condensed by a fogging mix, kg/s or lb/h. */
  condensate: number;
  /** Why it could not be resolved, if it could not. */
  error: string | null;
}

/**
 * Builds engine inputs for a stored point — a **factory**, not a value.
 *
 * `wasm-bindgen` *moves* a `StatePointInput` into Rust when it is passed, so the
 * JS wrapper is dead afterwards and using it a second time panics with "null
 * pointer passed to rust". A process needs its inlet twice — once to resolve the
 * outlet and once to position the arrow's tail — so every call site builds a
 * fresh one rather than sharing.
 */
function inputFor(point: StatePoint, ctx: ResolveContext): () => StatePointInput {
  return () =>
    new StatePointInput(
      point.dryBulb,
      point.secondValue,
      point.mode,
      ctx.altitude,
      ctx.isSi,
      ctx.realGas,
    );
}

/** The same, for a state the engine itself produced. */
function inputForState(
  state: StatePointOutput,
  ctx: ResolveContext,
): () => StatePointInput {
  // Round-tripping through (dry bulb, humidity ratio) rather than re-deriving:
  // it is the pair every outlet carries, and it is exact.
  return () =>
    new StatePointInput(
      state.dbt,
      state.humidity_ratio,
      InputState.DbtHumidityRatio,
      ctx.altitude,
      ctx.isSi,
      ctx.realGas,
    );
}

/** An empty result carrying only a reason. */
function failed(process: Process, error: string): ResolvedProcess {
  return {
    process,
    from: null,
    to: null,
    outlet: null,
    load: null,
    nearSaturation: false,
    fogged: false,
    condensate: 0,
    error,
  };
}

/** The context a process resolution needs: the document plus its points. */
export interface ProcessContext extends ResolveContext {
  /** Elevation as the document expresses it — the engine converts. */
  altitude: number;
  /** Every point, by id. */
  points: Map<string, StatePoint>;
  /** A translated "point is missing" message. */
  missingPointMessage: string;
}

/**
 * Resolves one process.
 *
 * A missing or unresolvable endpoint is an ordinary outcome rather than a
 * throw: deleting a point while a process references it is a normal edit, and
 * the panel needs to say what happened rather than go blank.
 */
export function resolveProcess(process: Process, ctx: ProcessContext): ResolvedProcess {
  const inlet = ctx.points.get(process.fromId);
  if (!inlet) return failed(process, ctx.missingPointMessage);

  try {
    const input = inputFor(inlet, ctx);
    const second = process.secondId ? ctx.points.get(process.secondId) : undefined;
    if (
      (process.kind === 'mix' ||
        process.kind === 'recovery' ||
        process.kind === 'link') &&
      !second
    ) {
      return failed(process, ctx.missingPointMessage);
    }

    switch (process.kind) {
      case 'sensible': {
        const r = apply_sensible(input(), process.targetT, process.mdot);
        return present(process, input, r.outlet, r.load, r.near_saturation, ctx);
      }
      case 'sensibleDuty': {
        const r = apply_sensible_duty(input(), process.duty, process.mdot);
        return present(process, input, r.outlet, r.load, r.near_saturation, ctx);
      }
      case 'steam': {
        const r = apply_steam_humidification(
          input(),
          process.targetW,
          process.steamEnthalpy,
          process.mdot,
        );
        return present(
          process,
          input,
          r.process.outlet,
          r.process.load,
          r.process.near_saturation,
          ctx,
        );
      }
      case 'evaporative': {
        const r = apply_evaporative(input(), process.effectiveness, process.mdot);
        return present(process, input, r.outlet, r.load, r.near_saturation, ctx);
      }
      case 'recovery': {
        const r = apply_energy_recovery(
          input(),
          inputFor(second!, ctx)(),
          process.epsSensible,
          process.epsLatent,
          process.mdot,
        );
        return present(process, input, r.outlet, r.load, r.near_saturation, ctx);
      }
      case 'mix': {
        const r = apply_mixing(
          input(),
          process.mdot,
          inputFor(second!, ctx)(),
          process.mdotSecond,
        );
        const load = process_load(input(), inputForState(r.outlet, ctx)(), process.mdot);
        const base = present(process, input, r.outlet, load, false, ctx);
        return { ...base, fogged: r.fogged, condensate: r.condensate };
      }
      case 'link': {
        const target = inputFor(second!, ctx);
        const load = process_load(input(), target(), process.mdot);
        return {
          process,
          from: chartPoint(input, ctx),
          to: chartPoint(target, ctx),
          outlet: null,
          load,
          nearSaturation: false,
          fogged: false,
          condensate: 0,
          error: null,
        };
      }
    }
  } catch (e: unknown) {
    return failed(process, e instanceof Error ? e.message : String(e));
  }
}

/** Chart-space position for an engine input, built fresh for the call. */
function chartPoint(build: () => StatePointInput, ctx: ProcessContext) {
  const p = get_coordinate_mapping(build(), ctx.layout);
  return { x: p.x, y: p.y };
}

/** Assembles the common shape once the engine has answered. */
function present(
  process: Process,
  input: () => StatePointInput,
  outlet: StatePointOutput,
  load: LoadOutput,
  nearSaturation: boolean,
  ctx: ProcessContext,
): ResolvedProcess {
  return {
    process,
    from: chartPoint(input, ctx),
    to: chartPoint(inputForState(outlet, ctx), ctx),
    outlet,
    load,
    nearSaturation,
    fogged: false,
    condensate: 0,
    error: null,
  };
}

/** Resolves every process in the document. */
export function useResolvedProcesses(
  processes: Process[],
  ctx: ProcessContext,
): ResolvedProcess[] {
  const { isSi, altitude, altitudeM, realGas, layout, points, missingPointMessage } = ctx;
  return useMemo(
    () =>
      processes.map((p) =>
        resolveProcess(p, {
          isSi,
          altitude,
          altitudeM,
          realGas,
          layout,
          points,
          missingPointMessage,
        }),
      ),
    [processes, isSi, altitude, altitudeM, realGas, layout, points, missingPointMessage],
  );
}
