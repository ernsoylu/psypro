/**
 * The design case a cycle macro is run on.
 *
 * Six numbers and two states. That is the whole input to the primary
 * return-air cycle, and keeping it that small is deliberate: the macro's value
 * is that it turns a *load* into a *design*, and every extra knob is one more
 * thing a reader has to check before believing the answer.
 *
 * Everything the cycle produces is derived, as everywhere else — change the
 * elevation and every intermediate state moves, because the physics moved.
 */

import { create } from 'zustand';

import { convertForUnits } from '../units';

/** The design case. */
export interface CycleState {
  /** Outdoor design dry-bulb, in the document's units. */
  outdoorT: number;
  /** Outdoor design relative humidity, percent. */
  outdoorRh: number;
  /** Room design dry-bulb. */
  roomT: number;
  /** Room design relative humidity, percent. */
  roomRh: number;
  /** Room sensible gain, kW or Btu/h. */
  qSensible: number;
  /** Room latent gain, kW or Btu/h. */
  qLatent: number;
  /** Supply air dry-bulb. §4.9 puts the usual difference at 10–14 K. */
  supplyT: number;
  /** Outdoor-air share of the supply flow, 0 to 1. */
  outdoorFraction: number;

  set: (patch: Partial<Omit<CycleState, 'set' | 'setForUnits'>>) => void;
  /**
   * Rewrites the case for a new unit system.
   *
   * Temperatures and loads are *quantities*, not labels: switching the document
   * to IP has to convert them, or a 24 °C room silently becomes a 24 °F one.
   */
  setForUnits: (toSi: boolean) => void;
}

/** A summer comfort-cooling case, which is the one most readers arrive with. */
const DEFAULT_SI = {
  outdoorT: 35,
  outdoorRh: 40,
  roomT: 24,
  roomRh: 50,
  qSensible: 20,
  qLatent: 5,
  supplyT: 13,
  outdoorFraction: 0.2,
};

export const useCycleStore = create<CycleState>((set) => ({
  ...DEFAULT_SI,

  set: (patch) => set(patch),

  // Through the same `units` table as points, processes and the site elevation.
  // A second copy of °C↔°F here is a second place for the two to disagree, and
  // the whole point of that table is that there is only one.
  setForUnits: (toSi) =>
    set((s) => ({
      outdoorT: convertForUnits('temperature', s.outdoorT, toSi),
      roomT: convertForUnits('temperature', s.roomT, toSi),
      supplyT: convertForUnits('temperature', s.supplyT, toSi),
      qSensible: convertForUnits('power', s.qSensible, toSi),
      qLatent: convertForUnits('power', s.qLatent, toSi),
    })),
}));
