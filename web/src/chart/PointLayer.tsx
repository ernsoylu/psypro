/**
 * Layer 3 — the state points, and the drag that edits them.
 *
 * The drag is the round trip the architecture is built around:
 *
 * ```
 * Konva screen coords → chart space → WASM → StatePointOutput → store
 * ```
 *
 * Nothing on that path computes a property in TypeScript, not even for the
 * intermediate frames. A "quick" JS approximation for a drag preview is exactly
 * the divergence the rule in `CLAUDE.md` forbids, and it shows up as a point
 * that jumps the moment you let go of it.
 *
 * The path runs once per pointer move, so it must stay allocation-light. It
 * makes one WASM call and writes two numbers; the grid layer beneath is cached
 * and its props do not change, so it is not repainted.
 */

import { useCallback } from 'react';
import { Circle, Group, Layer, Text } from 'react-konva';
import type Konva from 'konva';

import { toScreen, type Viewport } from './geometry';
import { InputState, state_from_chart_coordinates_clamped } from '../psychro';
import type { ChartTokens } from './useChartTokens';
import type { ResolvedPoint } from '../store/useResolvedPoints';
import type { ChartLayout } from '../psychro';

/** Marker radius in pixels. */
const RADIUS = 6;

/** Label offset from the marker centre. */
const LABEL_DX = 10;
const LABEL_DY = -16;

/** What the point layer needs. */
export interface PointLayerProps {
  /** The document's points, already resolved. */
  points: ResolvedPoint[];
  /**
   * Whether a marker may be dragged.
   *
   * False while the draw-process tool is active: there, a press on a marker
   * starts a *process* from it, and a marker that also moved under the same
   * gesture would make the two indistinguishable.
   */
  draggable?: boolean;
  /** Which one is selected. */
  selectedId: string | null;
  /** The chart-space → screen mapping. */
  viewport: Viewport;
  /** The resolved palette. */
  tokens: ChartTokens;
  /** Everything the inverse resolution needs. */
  layout: ChartLayout;
  altitude: number;
  isSi: boolean;
  realGas: boolean;
  /** Commits a new position for a point, as its defining inputs. */
  onMove: (id: string, dryBulb: number, humidityRatio: number) => void;
  /** Selects a point. */
  onSelect: (id: string) => void;
}

export function PointLayer({
  points,
  draggable = true,
  selectedId,
  viewport,
  tokens,
  layout,
  altitude,
  isSi,
  realGas,
  onMove,
  onSelect,
}: PointLayerProps) {
  const handleDrag = useCallback(
    (id: string) => (e: Konva.KonvaEventObject<globalThis.DragEvent>) => {
      const node = e.target;
      // Konva has already moved the node; read where it landed and turn that
      // back into thermodynamics.
      const chartX = (node.x() - viewport.offsetX) / viewport.scaleX;
      const chartY = (viewport.offsetY - node.y()) / viewport.scaleY;
      try {
        const resolved = state_from_chart_coordinates_clamped(
          chartX,
          chartY,
          layout,
          altitude,
          isSi,
          realGas,
        );
        const state = resolved.state;
        onMove(id, state.dbt, state.humidity_ratio);
      } catch {
        // Outside anything the engine can resolve even after clamping — leave
        // the point where it was rather than writing a state that is not one.
      }
    },
    [viewport, layout, altitude, isSi, realGas, onMove],
  );

  return (
    <Layer>
      {points.map((resolved) => {
        if (!resolved.position) return null;
        const { x, y } = toScreen(viewport, resolved.position.x, resolved.position.y);
        const selected = resolved.point.id === selectedId;
        return (
          <Group key={resolved.point.id}>
            <Circle
              x={x}
              y={y}
              radius={RADIUS}
              fill={tokens.point}
              stroke={tokens.background}
              strokeWidth={selected ? 3 : 1.5}
              draggable={draggable}
              onDragMove={handleDrag(resolved.point.id)}
              onDragStart={() => onSelect(resolved.point.id)}
              onMouseDown={() => onSelect(resolved.point.id)}
              // Konva's hit graph is a second canvas; a marker this small is
              // easier to grab if the hit area is drawn larger than the dot.
              hitStrokeWidth={RADIUS * 2}
              perfectDrawEnabled={false}
            />
            <Text
              x={x + LABEL_DX}
              y={y + LABEL_DY}
              text={resolved.point.label}
              fontSize={11}
              fontStyle="bold"
              fontFamily="monospace"
              fill={tokens.text}
              listening={false}
              perfectDrawEnabled={false}
            />
          </Group>
        );
      })}
    </Layer>
  );
}

/** The input mode a dragged point is stored in. */
export const DRAG_MODE = InputState.DbtHumidityRatio;
