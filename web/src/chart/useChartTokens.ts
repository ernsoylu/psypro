/**
 * Resolved theme tokens, for the canvas.
 *
 * Konva paints to a bitmap, so it needs a real colour string — `var(--…)` means
 * nothing to it. This hook is the bridge: the values still *live* in
 * `theme.css`, and a fork still rebrands the chart by editing that file alone,
 * but they are read out of the computed style rather than passed as literals.
 *
 * There is deliberately **no fallback palette**. A hard-coded default would be a
 * second copy of `theme.css` that nothing keeps in step, which is the exact
 * drift the theming rule exists to prevent — `src/theme.test.ts` rejected an
 * earlier version of this file for carrying one. When the variables have not
 * resolved, this returns `null` and the canvas draws nothing. In the browser
 * that is never observable, because `theme.css` is applied before React mounts;
 * under a test runner with no stylesheet it is the honest answer.
 *
 * It re-reads on a theme change, and watches the `data-theme` attribute rather
 * than taking the theme as an argument: the attribute is the source of truth
 * for which palette is live, and a prop could disagree with it.
 */

import { useEffect, useState } from 'react';

import { CurveFamilyId } from '../psychro';

/** The variable each curve family is styled by. */
const FAMILY_VARIABLE: Record<CurveFamilyId, string> = {
  [CurveFamilyId.DryBulb]: '--chart-grid-drybulb',
  [CurveFamilyId.HumidityRatio]: '--chart-grid-humidity-ratio',
  [CurveFamilyId.RelativeHumidity]: '--chart-grid-rh',
  [CurveFamilyId.WetBulb]: '--chart-grid-wetbulb',
  [CurveFamilyId.Enthalpy]: '--chart-grid-enthalpy',
  [CurveFamilyId.SpecificVolume]: '--chart-grid-volume',
};

/** Everything the canvas needs to paint Layer 0. */
export interface ChartTokens {
  /** Stroke colour per family. */
  family: Record<CurveFamilyId, string>;
  /** The saturation line, drawn heavier than the 100% RH curve it is. */
  saturation: string;
  /** Axis and tick colour. */
  axis: string;
  /** Label colour. */
  text: string;
  /** The canvas ground. */
  background: string;
}

/** Reads the live palette off the document root, or `null` if it has not resolved. */
function readTokens(): ChartTokens | null {
  if (typeof window === 'undefined') return null;
  const style = window.getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();

  const saturation = read('--chart-saturation');
  if (!saturation) return null;

  const family = {} as Record<CurveFamilyId, string>;
  for (const [id, variable] of Object.entries(FAMILY_VARIABLE)) {
    family[Number(id) as CurveFamilyId] = read(variable);
  }

  return {
    family,
    saturation,
    axis: read('--color-text-muted'),
    text: read('--color-text'),
    background: read('--color-bg'),
  };
}

/** The live palette, re-read whenever the theme changes. */
export function useChartTokens(): ChartTokens | null {
  const [tokens, setTokens] = useState<ChartTokens | null>(readTokens);

  useEffect(() => {
    const update = () => setTokens(readTokens());
    update();

    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return tokens;
}
