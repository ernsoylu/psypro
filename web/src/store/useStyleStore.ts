/**
 * Which layers are drawn, and how.
 *
 * Phase 12 turns this into the full line-styling matrix. What it holds now is
 * the part Layer 0 already needs: per-family visibility, so a reader can strip
 * the chart down to the families they are working with. A wet-bulb line and a
 * specific-volume line cross the others at shallow angles, and on a dense chart
 * turning one family off is the difference between reading a value and guessing
 * it.
 *
 * Colours are *not* here. They live in `theme.css` and resolve through
 * `useChartTokens`, so a fork rebrands the chart by editing one file — putting a
 * colour in this store would be a second source of truth for the palette.
 */

import { create } from 'zustand';

import { CurveFamilyId } from '../psychro';

/** The families a reader can switch off. */
export const TOGGLEABLE_FAMILIES: CurveFamilyId[] = [
  CurveFamilyId.DryBulb,
  CurveFamilyId.HumidityRatio,
  CurveFamilyId.RelativeHumidity,
  CurveFamilyId.WetBulb,
  CurveFamilyId.Enthalpy,
  CurveFamilyId.SpecificVolume,
];

/** What the style store holds. */
export interface StyleState {
  /** Whether each curve family is drawn. */
  visible: Record<CurveFamilyId, boolean>;
  /** Whether the axis numerals and titles are drawn. */
  showLabels: boolean;
  /** Whether the HUD crosshair follows the pointer. */
  showCrosshair: boolean;

  toggleFamily: (family: CurveFamilyId) => void;
  setShowLabels: (show: boolean) => void;
  setShowCrosshair: (show: boolean) => void;
}

/** Everything on, which is what a psychrometric chart is for. */
const ALL_VISIBLE = Object.fromEntries(
  TOGGLEABLE_FAMILIES.map((f) => [f, true]),
) as Record<CurveFamilyId, boolean>;

export const useStyleStore = create<StyleState>((set) => ({
  visible: ALL_VISIBLE,
  showLabels: true,
  showCrosshair: true,

  toggleFamily: (family) =>
    set((s) => ({ visible: { ...s.visible, [family]: !s.visible[family] } })),
  setShowLabels: (showLabels) => set({ showLabels }),
  setShowCrosshair: (showCrosshair) => set({ showCrosshair }),
}));

/**
 * Whether a curve should be drawn.
 *
 * **Saturation is never hidden.** It is 100% relative humidity, so switching the
 * RH family off would take it with it — and it is the boundary of the physical
 * region, not one more gridline. A chart without it does not say where air stops
 * being air.
 */
export function isCurveVisible(
  visible: Record<CurveFamilyId, boolean>,
  family: CurveFamilyId,
  value: number,
): boolean {
  if (family === CurveFamilyId.RelativeHumidity && Math.abs(value - 1) < 1e-9) {
    return true;
  }
  return visible[family] ?? true;
}
