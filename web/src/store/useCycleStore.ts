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

const C_TO_F = (c: number) => c * 1.8 + 32;
const F_TO_C = (f: number) => (f - 32) / 1.8;
const KW_TO_BTUH = (q: number) => q * 3412.141633;
const BTUH_TO_KW = (q: number) => q / 3412.141633;

export const useCycleStore = create<CycleState>((set) => ({
  ...DEFAULT_SI,

  set: (patch) => set(patch),

  setForUnits: (toSi) =>
    set((s) => ({
      outdoorT: toSi ? F_TO_C(s.outdoorT) : C_TO_F(s.outdoorT),
      roomT: toSi ? F_TO_C(s.roomT) : C_TO_F(s.roomT),
      supplyT: toSi ? F_TO_C(s.supplyT) : C_TO_F(s.supplyT),
      qSensible: toSi ? BTUH_TO_KW(s.qSensible) : KW_TO_BTUH(s.qSensible),
      qLatent: toSi ? BTUH_TO_KW(s.qLatent) : KW_TO_BTUH(s.qLatent),
    })),
}));
