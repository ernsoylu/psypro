/**
 * Layer 0 — the base grid, as Konva lines.
 *
 * Cached with `listening={false}` and Konva's own layer cache: nothing on this
 * layer is interactive, so it is painted once to an offscreen bitmap and blitted
 * on every subsequent frame. That is what keeps a pan at 60 FPS with roughly a
 * hundred curves on screen — repainting them per frame is affordable on a
 * desktop and is not on a laptop with the fans off.
 *
 * The cache is invalidated only when the painted result would differ: new
 * curve data, a change of viewport, a theme switch, or an edit in the styling
 * matrix. Not a re-render.
 */

import { useEffect, useRef } from 'react';
import { Layer, Line } from 'react-konva';
import type Konva from 'konva';

import { curveStyle } from './style';
import { projectFlat, type Viewport } from './geometry';
import type { GridCurve } from './useBaseGrid';
import type { ChartTokens } from './useChartTokens';
import type { CurveFamilyId } from '../psychro';
import type { FamilyStyle } from '../store/useStyleStore';

/** What Layer 0 needs to paint itself. */
export interface PsychGridProps {
  /** The generated curves, in chart space. */
  curves: GridCurve[];
  /** The chart-space → screen mapping. */
  viewport: Viewport;
  /** The resolved palette. */
  tokens: ChartTokens;
  /** The line-styling matrix: colour, dash, and width per family. */
  styles: Record<CurveFamilyId, FamilyStyle>;
  /** The canvas box, so the cache covers the whole layer. */
  width: number;
  height: number;
}

export function PsychGrid({
  curves,
  viewport,
  tokens,
  styles,
  width,
  height,
}: PsychGridProps) {
  const layer = useRef<Konva.Layer>(null);

  useEffect(() => {
    const node = layer.current;
    if (!node || width <= 0 || height <= 0) return;
    // Re-cache whenever the painted result would differ. Konva keeps the old
    // bitmap until `cache()` is called again, so this must run after the lines
    // have their new props — which an effect, running post-commit, does.
    node.clearCache();
    node.cache({ pixelRatio: window.devicePixelRatio || 1 });
    node.batchDraw();
  }, [curves, viewport, tokens, styles, width, height]);

  return (
    <Layer ref={layer} listening={false}>
      {curves.map((curve) => {
        const style = curveStyle(curve.family, curve.value, tokens, styles);
        return (
          <Line
            key={`${curve.family}:${curve.value}`}
            points={projectFlat(viewport, curve.coords)}
            stroke={style.stroke}
            strokeWidth={style.strokeWidth}
            opacity={style.opacity}
            {...(style.dash ? { dash: style.dash } : {})}
            lineCap="round"
            lineJoin="round"
            perfectDrawEnabled={false}
            listening={false}
          />
        );
      })}
    </Layer>
  );
}
