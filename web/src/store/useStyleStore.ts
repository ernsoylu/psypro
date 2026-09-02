/**
 * Which layers are drawn, and how.
 *
 * Holds the line-styling matrix of REQUIREMENTS.md §8: per curve family, a
 * colour, a line style, and a width — plus per-family visibility, so a reader
 * can strip the chart down to the families they are working with. A wet-bulb
 * line and a specific-volume line cross the others at shallow angles, and on a
 * dense chart turning one family off is the difference between reading a value
 * and guessing it.
 *
 * The theme's palette is *not* here. Colours live in `theme.css` and resolve
 * through `useChartTokens`; what lives here is the reader's overrides on top of
 * that palette. A `null` colour means "the theme's colour for this family", so
 * a fork that rebrands `theme.css` keeps every family the reader has not
 * deliberately recoloured.
 *
 * Styles are session state: they apply to the chart on screen and to its
 * exports, but they are not written into `.psy` project files. A document
 * carries the engineering — points, processes, elevation — not one reader's
 * display preferences.
 */

import { create } from 'zustand';

import { CurveFamilyId } from '../psychro';
import type { TranslationKey } from '../i18n';

/** The families a reader can switch off. */
export const TOGGLEABLE_FAMILIES: CurveFamilyId[] = [
  CurveFamilyId.DryBulb,
  CurveFamilyId.HumidityRatio,
  CurveFamilyId.RelativeHumidity,
  CurveFamilyId.WetBulb,
  CurveFamilyId.Enthalpy,
  CurveFamilyId.SpecificVolume,
];

/** Each curve family and what it is called in the UI. */
export const FAMILY_LABELS = [
  [CurveFamilyId.DryBulb, 'family.dryBulb'],
  [CurveFamilyId.HumidityRatio, 'family.humidityRatio'],
  [CurveFamilyId.RelativeHumidity, 'family.relativeHumidity'],
  [CurveFamilyId.WetBulb, 'family.wetBulb'],
  [CurveFamilyId.Enthalpy, 'family.enthalpy'],
  [CurveFamilyId.SpecificVolume, 'family.specificVolume'],
] as const satisfies readonly (readonly [CurveFamilyId, TranslationKey])[];

/** The dash styles the matrix offers, per REQUIREMENTS.md §8. */
export type LineStyle = 'solid' | 'dotted' | 'dashed';

/** The reader's styling choice for one curve family. */
export interface FamilyStyle {
  /** The stroke colour, or null to take the theme's colour for the family. */
  color: string | null;
  /** Solid, dotted, or dashed. */
  lineStyle: LineStyle;
  /**
   * Stroke width for the family's emphasised lines. Families with major and
   * minor members derive the minor width from this at a fixed ratio.
   */
  width: number;
}

/**
 * The styling matrix at its defaults.
 *
 * These reproduce the chart's historical drawing: wet-bulb and specific volume
 * are dashed because they cross the other families at shallow angles, and the
 * relative-humidity curves are slightly heavier because a reader counts along
 * them. Widths and dashes flow through `curveStyle`, which reads them for every
 * curve it styles.
 */
export const DEFAULT_STYLES: Record<CurveFamilyId, FamilyStyle> = {
  [CurveFamilyId.DryBulb]: { color: null, lineStyle: 'solid', width: 1 },
  [CurveFamilyId.HumidityRatio]: { color: null, lineStyle: 'solid', width: 1 },
  [CurveFamilyId.RelativeHumidity]: { color: null, lineStyle: 'solid', width: 1.1 },
  [CurveFamilyId.WetBulb]: { color: null, lineStyle: 'dashed', width: 0.8 },
  [CurveFamilyId.Enthalpy]: { color: null, lineStyle: 'solid', width: 1 },
  [CurveFamilyId.SpecificVolume]: { color: null, lineStyle: 'dashed', width: 0.8 },
};

/** The bounds the width input allows, kept here so the store enforces them. */
export const MIN_STYLE_WIDTH = 0.25;
export const MAX_STYLE_WIDTH = 8;

/** What the style store holds. */
export interface StyleState {
  /** Whether each curve family is drawn. */
  visible: Record<CurveFamilyId, boolean>;
  /** The line-styling matrix: colour, dash, and width per family. */
  styles: Record<CurveFamilyId, FamilyStyle>;
  /** Whether the axis numerals and titles are drawn. */
  showLabels: boolean;
  /** Whether the HUD crosshair follows the pointer. */
  showCrosshair: boolean;

  toggleFamily: (family: CurveFamilyId) => void;
  /** Patches one family's style; a null colour restores the theme's colour. */
  setFamilyStyle: (family: CurveFamilyId, patch: Partial<FamilyStyle>) => void;
  /** Restores one family to the defaults. */
  resetFamilyStyle: (family: CurveFamilyId) => void;
  /** Restores every family to the defaults. */
  resetAllStyles: () => void;
  setShowLabels: (show: boolean) => void;
  setShowCrosshair: (show: boolean) => void;
}

/** Everything on, which is what a psychrometric chart is for. */
const ALL_VISIBLE = Object.fromEntries(
  TOGGLEABLE_FAMILIES.map((f) => [f, true]),
) as Record<CurveFamilyId, boolean>;

/** Clamps a width to what the drawing pipeline accepts. */
function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_STYLE_WIDTH;
  return Math.min(MAX_STYLE_WIDTH, Math.max(MIN_STYLE_WIDTH, width));
}

export const useStyleStore = create<StyleState>((set) => ({
  visible: ALL_VISIBLE,
  styles: DEFAULT_STYLES,
  showLabels: true,
  showCrosshair: true,

  toggleFamily: (family) =>
    set((s) => ({ visible: { ...s.visible, [family]: !s.visible[family] } })),
  setFamilyStyle: (family, patch) =>
    set((s) => ({
      styles: {
        ...s.styles,
        [family]: {
          ...s.styles[family],
          ...patch,
          ...(patch.width !== undefined ? { width: clampWidth(patch.width) } : {}),
        },
      },
    })),
  resetFamilyStyle: (family) =>
    set((s) => ({ styles: { ...s.styles, [family]: DEFAULT_STYLES[family] } })),
  resetAllStyles: () => set({ styles: DEFAULT_STYLES }),
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
