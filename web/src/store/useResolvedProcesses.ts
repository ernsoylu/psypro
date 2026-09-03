/**
 * One stored process definition → its outlet, its load, and its chart geometry.
 *
 * The same shape as `resolvePoint`, for the same reason: a process holds what it
 * *does*, and everything it produces is derived. Change the elevation and every
 * outlet moves, because the physics moved.
 *
 * Every number here comes from a WASM call. The load decomposition in
 * particular is done in Rust rather than here, so the SHR shown in the panel and
 * the protractor drawn on the chart come from one place and cannot disagree.
 *
 * # This takes resolved *states*, not stored points
 *
 * It used to take the stored points and re-resolve its own inlet. It cannot any
 * more, and the reason is the whole point of the rework: an inlet may itself be
 * the outlet of an earlier process, in which case it has no stored inputs to
 * re-resolve — it has a *state*, which `useResolvedDocument` has already worked
 * out in dependency order. Taking the state also removes a duplicate resolution
 * per process on the drag path.
 */

import {
  apply_cooling,
  apply_cooling_duty,
  apply_desiccant,
  apply_energy_recovery,
  apply_evaporative,
  apply_mixing,
  apply_room_load,
  apply_split,
  apply_steam_humidification,
  get_coordinate_mapping,
  identify_process,
  process_load,
  solve_coil_from_adp,
  InputState,
  StatePointInput,
  type CoilOutput,
  type LoadOutput,
  type ProcessFitOutput,
  type StatePointOutput,
} from '../psychro';
import type { Process } from './useProcessStore';
import type { ChartPosition, ResolveContext } from './useResolvedPoints';

/** A process with everything the chart and the panel need. */
export interface ResolvedProcess {
  /** The stored definition this came from. */
  process: Process;
  /** Chart-space start, or null if the inlet did not resolve. */
  from: ChartPosition | null;
  /** Chart-space end, or null if the outlet did not resolve. */
  to: ChartPosition | null;
  /** The state the air leaves in. */
  outlet: StatePointOutput | null;
  /** What the process moved. */
  load: LoadOutput | null;
  /** Whether the outlet is close enough to saturation to need a second look. */
  nearSaturation: boolean;
  /** Whether a mix fogged and dropped water out. */
  fogged: boolean;
  /** Water condensed out, kg/s or lb/h — by a wet coil or a fogging mix. */
  condensate: number;
  /**
   * Whether a coil that was asked for a temperature ran *wet*.
   *
   * The flag the panel needs to stop describing a horizontal process: the
   * target went below the entering dew point, so the air turned toward the
   * apparatus dew point and left drier than it arrived.
   */
  dehumidified: boolean;
  /** Whether the coil's surface sits below freezing, so it frosts. */
  frostRisk: boolean;
  /** The coil construction — ADP, three bypass factors, coil SHR — when wet. */
  coil: CoilOutput | null;
  /**
   * What the two endpoints of a `link` turned out to be.
   *
   * The engine names the process and backs out its defining parameters, which is
   * what makes "I have two points, give me the process between them" answerable
   * with more than a load.
   */
  fit: ProcessFitOutput | null;
  /** Dry-air mass flow down a `split`'s first branch. */
  mdotFirst: number;
  /** Dry-air mass flow down a `split`'s second branch. */
  mdotSecond: number;
  /**
   * How far a tear point's specified state is from what this process produced.
   *
   * The convergence error a flowsheet solver would iterate away. Null when the
   * outlet is not a tear. Reported rather than hidden: a designer who has
   * specified a return-air condition the circuit does not actually deliver has
   * a design problem, and it is this number.
   */
  tearMismatch: TearMismatch | null;
  /** Why it could not be resolved, if it could not. */
  error: string | null;
}

/** The gap between a specified tear state and the computed one. */
export interface TearMismatch {
  /** Specified minus computed dry-bulb, in the document's units. */
  dryBulb: number;
  /** Specified minus computed humidity ratio. */
  humidityRatio: number;
}

/** The context a process resolution needs: the document plus its resolved points. */
export interface ProcessContext extends ResolveContext {
  /** Elevation as the document expresses it — the engine converts. */
  altitude: number;
  /** The resolved state of a point, or null when it has none. */
  stateOf: (id: string) => StatePointOutput | null;
  /** The chart-space position of a point, or null when it has none. */
  positionOf: (id: string) => ChartPosition | null;
  /** A translated "point is missing" message. */
  missingPointMessage: string;
}

/** An empty result carrying only a reason. */
export function failedProcess(process: Process, error: string): ResolvedProcess {
  return {
    process,
    from: null,
    to: null,
    outlet: null,
    load: null,
    nearSaturation: false,
    fogged: false,
    condensate: 0,
    dehumidified: false,
    frostRisk: false,
    coil: null,
    fit: null,
    mdotFirst: 0,
    mdotSecond: 0,
    tearMismatch: null,
    error,
  };
}

/**
 * Builds engine inputs for a resolved state — a **factory**, not a value.
 *
 * `wasm-bindgen` *moves* a `StatePointInput` into Rust when it is passed, so the
 * JS wrapper is dead afterwards and using it a second time panics with "null
 * pointer passed to rust". A process needs its inlet more than once, so every
 * call site builds a fresh one rather than sharing.
 *
 * The pair is (dry bulb, humidity ratio) rather than anything re-derived: it is
 * what every resolved state carries, and it is exact.
 */
function inputForState(
  state: StatePointOutput,
  ctx: ProcessContext,
): () => StatePointInput {
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

/** Chart-space position for a state the engine produced. */
function chartPointOf(state: StatePointOutput, ctx: ProcessContext): ChartPosition {
  const p = get_coordinate_mapping(inputForState(state, ctx)(), ctx.layout);
  return { x: p.x, y: p.y };
}

/**
 * Resolves one process against already-resolved endpoints.
 *
 * A missing or unresolvable endpoint is an ordinary outcome rather than a
 * throw: deleting a point while a process references it is a normal edit, and
 * the panel needs to say what happened rather than go blank.
 */
export function resolveProcess(process: Process, ctx: ProcessContext): ResolvedProcess {
  const inletState = ctx.stateOf(process.fromId);
  if (!inletState) return failedProcess(process, ctx.missingPointMessage);

  const from = ctx.positionOf(process.fromId);
  const input = inputForState(inletState, ctx);

  /** Assembles the common shape once the engine has answered. */
  const present = (
    outlet: StatePointOutput,
    load: LoadOutput,
    nearSaturation: boolean,
    extra: Partial<ResolvedProcess> = {},
  ): ResolvedProcess => ({
    process,
    from,
    to: chartPointOf(outlet, ctx),
    outlet,
    load,
    nearSaturation,
    fogged: false,
    condensate: 0,
    dehumidified: false,
    frostRisk: false,
    coil: null,
    fit: null,
    mdotFirst: 0,
    mdotSecond: 0,
    tearMismatch: null,
    error: null,
    ...extra,
  });

  try {
    const secondState = process.secondId ? ctx.stateOf(process.secondId) : null;
    if (
      (process.kind === 'mix' ||
        process.kind === 'recovery' ||
        process.kind === 'link') &&
      !secondState
    ) {
      return failedProcess(process, ctx.missingPointMessage);
    }

    switch (process.kind) {
      case 'sensible': {
        const r = apply_cooling(
          input(),
          process.targetT,
          process.bypassFactor,
          process.mdot,
        );
        return present(r.process.outlet, r.process.load, r.process.near_saturation, {
          dehumidified: r.dehumidified,
          condensate: r.condensate,
          frostRisk: r.frost_risk,
          coil: r.coil ?? null,
        });
      }
      case 'sensibleDuty': {
        const r = apply_cooling_duty(
          input(),
          process.duty,
          process.bypassFactor,
          process.mdot,
        );
        return present(r.process.outlet, r.process.load, r.process.near_saturation, {
          dehumidified: r.dehumidified,
          condensate: r.condensate,
          frostRisk: r.frost_risk,
          coil: r.coil ?? null,
        });
      }
      case 'cooling': {
        const coil = solve_coil_from_adp(
          input(),
          process.tAdp,
          process.bypassFactor,
          process.mdot,
        );
        const load = process_load(
          input(),
          inputForState(coil.leaving, ctx)(),
          process.mdot,
        );
        return present(coil.leaving, load, coil.leaving.rh >= 85, {
          // A coil selected by its ADP is wet unless the construction itself
          // says otherwise, which is what `dry` reports.
          dehumidified: !coil.dry,
          condensate: coil.condensate,
          frostRisk: coil.adp.dbt < (ctx.isSi ? 0 : 32),
          coil,
        });
      }
      case 'steam': {
        const r = apply_steam_humidification(
          input(),
          process.targetW,
          process.steamEnthalpy,
          process.mdot,
        );
        return present(r.process.outlet, r.process.load, r.process.near_saturation, {});
      }
      case 'evaporative': {
        const r = apply_evaporative(input(), process.effectiveness, process.mdot);
        return present(r.outlet, r.load, r.near_saturation);
      }
      case 'desiccant': {
        const r = apply_desiccant(
          input(),
          process.wEquilibrium,
          process.epsLatent,
          process.mdot,
        );
        return present(r.outlet, r.load, r.near_saturation);
      }
      case 'recovery': {
        const r = apply_energy_recovery(
          input(),
          inputForState(secondState!, ctx)(),
          process.epsSensible,
          process.epsLatent,
          process.mdot,
        );
        return present(r.outlet, r.load, r.near_saturation);
      }
      case 'load': {
        const r = apply_room_load(
          input(),
          process.qSensible,
          process.qLatent,
          process.mdot,
        );
        return present(r.outlet, r.load, r.near_saturation);
      }
      case 'split': {
        const r = apply_split(input(), process.splitFraction, process.mdot);
        // Both branches carry the entering state, so the "process" moves
        // nothing at all: its load is zero by construction rather than by
        // arithmetic, and reporting one would invite a reader to believe a
        // relief damper conditioned something.
        const load = process_load(input(), inputForState(r.outlet, ctx)(), process.mdot);
        return present(r.outlet, load, false, {
          mdotFirst: r.mdot_first,
          mdotSecond: r.mdot_second,
        });
      }
      case 'mix': {
        const r = apply_mixing(
          input(),
          process.mdot,
          inputForState(secondState!, ctx)(),
          process.mdotSecond,
        );
        const load = process_load(input(), inputForState(r.outlet, ctx)(), process.mdot);
        return present(r.outlet, load, false, {
          fogged: r.fogged,
          condensate: r.condensate,
        });
      }
      case 'link': {
        const target = inputForState(secondState!, ctx);
        const load = process_load(input(), target(), process.mdot);
        // The identification is the reason this kind exists at all. Without it
        // a line between two points reports a load and nothing about what the
        // line *is*.
        const fit = identify_process(input(), target(), process.mdot);
        return {
          process,
          from,
          to: ctx.positionOf(process.secondId!),
          // A link does not derive a state: both of its endpoints already
          // exist, and claiming an outlet here would duplicate one of them.
          outlet: null,
          load,
          nearSaturation: false,
          fogged: false,
          condensate: 0,
          dehumidified: false,
          frostRisk: false,
          coil: null,
          fit,
          mdotFirst: 0,
          mdotSecond: 0,
          tearMismatch: null,
          error: null,
        };
      }
    }
  } catch (e: unknown) {
    return failedProcess(process, e instanceof Error ? e.message : String(e));
  }
}
