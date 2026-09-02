/**
 * Layer 3, lower half — the process vectors.
 *
 * Drawn beneath the state points so a marker is always grabbable: a process
 * line runs *between* two markers, and a line drawn over them would swallow the
 * click that selects one.
 *
 * The arrowhead is the whole point of drawing a process rather than a line. A
 * psychrometric process has a direction — evaporative cooling goes up and to the
 * left, desiccant dehumidification down and to the right, and the two are drawn
 * on the same axis. Without the head, half the vocabulary in §4.1 is ambiguous.
 */

import { Arrow, Layer, Line } from 'react-konva';
import type Konva from 'konva';

import { toScreen, type Viewport } from './geometry';
import { ChartLayout } from '../psychro';
import type { ChartTokens } from './useChartTokens';
import type { ResolvedProcess } from '../store/useResolvedProcesses';

/**
 * The latent reference enthalpy the chart's reduced coordinate is defined
 * against, `h_g,ref = 2499.86 kJ/kg` (ASHRAE RP-1485).
 *
 * The one physical constant in the rendering layer, and it is here because it is
 * a property of the *chart geometry* rather than of the air: the engine's own
 * `psychrochart` module is defined against the same value, and `process.rs`
 * splits its loads with it, so all three agree by construction. Substituting
 * 2501 would put every protractor line on a slightly wrong angle.
 */
const H_G_REF = 2499.86;

/** What the process layer needs. */
export interface ProcessLayerProps {
  /** The document's processes, already resolved. */
  processes: ResolvedProcess[];
  /** Which one is selected. */
  selectedId: string | null;
  /** The chart-space → screen mapping. */
  viewport: Viewport;
  /** The resolved palette. */
  tokens: ChartTokens;
  /** Selects a process. */
  onSelect: (id: string) => void;
}

/** Arrowhead size in pixels. */
const HEAD = 9;

export function ProcessLayer({
  processes,
  selectedId,
  viewport,
  tokens,
  onSelect,
}: ProcessLayerProps) {
  return (
    <Layer>
      {processes.map((resolved) => {
        if (!resolved.from || !resolved.to) return null;
        const a = toScreen(viewport, resolved.from.x, resolved.from.y);
        const b = toScreen(viewport, resolved.to.x, resolved.to.y);
        const selected = resolved.process.id === selectedId;
        const width = selected ? 2.5 : 1.75;
        const select = (e: Konva.KonvaEventObject<globalThis.MouseEvent>) => {
          // Stop the stage handler from reading this as a click on empty chart,
          // which in placing mode would drop a point on top of the line.
          e.cancelBubble = true;
          onSelect(resolved.process.id);
        };

        return (
          <Arrow
            key={resolved.process.id}
            points={[a.x, a.y, b.x, b.y]}
            stroke={resolved.fogged ? tokens.saturation : tokens.process}
            fill={resolved.fogged ? tokens.saturation : tokens.process}
            strokeWidth={width}
            pointerLength={HEAD}
            pointerWidth={HEAD}
            // A fogging mix is a different physical event, not a warning
            // decoration: the mixture crossed saturation and dropped water. It
            // gets the saturation colour and a dashed line so it reads as one.
            {...(resolved.fogged ? { dash: [7, 4] } : {})}
            hitStrokeWidth={12}
            onMouseDown={select}
            onClick={select}
            perfectDrawEnabled={false}
          />
        );
      })}
    </Layer>
  );
}

/** A set of parallel reference lines at one sensible heat ratio. */
export interface ProtractorProps {
  /** Chart-space slope `Δh/ΔW`, or null for a fully sensible process. */
  slope: number | null;
  /** Which construction the chart is drawn in. */
  layout: ChartLayout;
  /** Where the reference lines pass through, in chart space. */
  through: { x: number; y: number } | null;
  /** The chart-space → screen mapping. */
  viewport: Viewport;
  /** The resolved palette. */
  tokens: ChartTokens;
  /** The canvas box. */
  width: number;
  height: number;
}

/**
 * The SHR reference line through the selected point.
 *
 * A printed chart carries a protractor in the corner and the reader transfers
 * its angle by eye with a pair of parallel rules. Here the line is drawn through
 * the point directly, which is the same construction with the transfer error
 * removed.
 *
 * `slope === null` is SHR = 1: no moisture moves, so the line is horizontal.
 * That is the data-centre case and it is a real design, not a degenerate one.
 */
export function ProtractorLine({
  slope,
  layout,
  through,
  viewport,
  tokens,
  width,
  height,
}: ProtractorProps) {
  if (!through) return null;

  // Δh/ΔW is a slope in (W, h) space; the chart's reduced axis carries
  // σ = h − h_g,ref·W. A step of ΔW therefore moves σ by (slope − h_g,ref)·ΔW,
  // which is exactly what makes SHR = 1 horizontal: at that slope the moisture
  // step is zero and only σ moves.
  //
  // The scale factor is arbitrary — only the direction matters, and the line is
  // normalised below — but it has to be small enough that the two components
  // stay comparable, because σ is in kJ/kg and W is in kg/kg.
  const SCALE = 1e-4;
  const dSigma = (slope === null ? 1 : slope - H_G_REF) * SCALE;
  const dW = (slope === null ? 0 : 1) * SCALE;

  // Mollier i-x is the same reduced space with the axes exchanged, so the
  // direction swaps components rather than being recomputed.
  const [dChartX, dChartY] =
    layout === ChartLayout.MollierIx ? [dW, dSigma] : [dSigma, dW];

  const origin = toScreen(viewport, through.x, through.y);
  const stepped = toScreen(viewport, through.x + dChartX, through.y + dChartY);
  const dx = stepped.x - origin.x;
  const dy = stepped.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;

  // Extend across the whole canvas in both directions, which is what makes it a
  // reference line rather than a segment.
  const reach = (width + height) / length;
  return (
    <Line
      points={[
        origin.x - dx * reach,
        origin.y - dy * reach,
        origin.x + dx * reach,
        origin.y + dy * reach,
      ]}
      stroke={tokens.process}
      strokeWidth={1}
      dash={[2, 5]}
      opacity={0.65}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}
