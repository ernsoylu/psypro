/**
 * Layer 2 — the weather density heatmap.
 *
 * 8760 markers is a smear, not a picture. The information a reader wants from a
 * year of weather is *where the climate sits*, which is density, so the hours
 * are binned and the bins are drawn.
 *
 * Cells are drawn as chart-space quadrilaterals rather than screen-space
 * rectangles. A bin is a range of dry bulb and humidity ratio, and the chart's
 * axes are oblique — a bin is a parallelogram there, and drawing an axis-aligned
 * rectangle would put its corners in the wrong place by a visible margin at the
 * warm end.
 */

import { useMemo } from 'react';
import { Layer, Line } from 'react-konva';

import { toScreen, type Viewport } from './geometry';
import { chart_lattice } from '../psychro';
import type { ChartLayout } from '../psychro';
import type { BinGrid } from '../weather/epw.worker';
import type { ChartTokens } from './useChartTokens';

/** What the weather layer needs. */
export interface WeatherLayerProps {
  /** The binned hours, or null when no file is loaded. */
  bins: BinGrid | null;
  /** The chart-space → screen mapping. */
  viewport: Viewport;
  /** The resolved palette. */
  tokens: ChartTokens;
  /** Which construction the chart is drawn in. */
  layout: ChartLayout;
}

/**
 * The lightest a cell is drawn, as a fraction of full opacity.
 *
 * A cell holding one hour still has to be visible: the outliers are where a
 * design's worst case lives, and a heatmap that fades them out hides exactly the
 * hours a reader is looking for.
 */
const MIN_ALPHA = 0.12;

export function WeatherLayer({ bins, viewport, tokens, layout }: WeatherLayerProps) {
  const cells = useMemo(() => {
    if (!bins || bins.tCount === 0) return [];

    // The whole lattice in ONE call. The first version asked the engine for a
    // chart position per corner, which resolved a full state each time — a few
    // thousand round trips, and a 467 ms frame gap in a trace. The lattice is
    // pure geometry, so it is pure arithmetic.
    const lattice = chart_lattice(
      bins.tMin,
      bins.tStep,
      bins.tCount + 1,
      bins.wMin,
      bins.wStep,
      bins.wCount + 1,
      layout,
    );
    const stride = (bins.tCount + 1) * 2;
    const at = (row: number, col: number) => ({
      x: lattice[row * stride + col * 2] ?? Number.NaN,
      y: lattice[row * stride + col * 2 + 1] ?? Number.NaN,
    });

    const out: { key: string; points: number[]; alpha: number }[] = [];
    for (let row = 0; row < bins.wCount; row += 1) {
      for (let col = 0; col < bins.tCount; col += 1) {
        const count = bins.counts[row * bins.tCount + col] ?? 0;
        if (count === 0) continue;
        const a = at(row, col);
        const b = at(row, col + 1);
        const c = at(row + 1, col + 1);
        const d = at(row + 1, col);
        if ([a, b, c, d].some((p) => !Number.isFinite(p.x))) continue;

        out.push({
          key: `${row}:${col}`,
          // Chart space; projected below, so a pan reuses the lattice.
          points: [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y],
          // Square-root scaling rather than linear: a climate's peak cell can
          // hold a hundred times the hours of a typical one, and a linear ramp
          // would render everything but the peak as blank.
          alpha: MIN_ALPHA + (1 - MIN_ALPHA) * Math.sqrt(count / Math.max(bins.peak, 1)),
        });
      }
    }
    return out;
  }, [bins, layout]);

  if (cells.length === 0) return null;

  return (
    <Layer listening={false}>
      {cells.map((cell) => {
        const screen: number[] = [];
        for (let i = 0; i < cell.points.length; i += 2) {
          const p = toScreen(viewport, cell.points[i]!, cell.points[i + 1]!);
          screen.push(p.x, p.y);
        }
        return (
          <Line
            key={cell.key}
            points={screen}
            closed
            fill={tokens.process}
            opacity={cell.alpha * 0.55}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })}
    </Layer>
  );
}
