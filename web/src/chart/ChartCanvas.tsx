/**
 * The chart canvas: the Konva stage and the layer pipeline.
 *
 * Layers 1 to 4 arrive in later phases and each mounts as its own component, so
 * a new visual layer never requires touching an existing one — that ordering is
 * REQUIREMENTS §7 and it is the reason this file is a list rather than a
 * renderer.
 *
 * Pointer handling lives here rather than inside a layer because a drag is a
 * property of the *view*, not of anything drawn in it.
 */

import { useCallback, useRef, type WheelEvent } from 'react';
import { Stage } from 'react-konva';
import type Konva from 'konva';

import { ChartAxes } from './ChartAxes';
import { PsychGrid } from './PsychGrid';
import { useBaseGrid, type BaseGridParams } from './useBaseGrid';
import { useChartTokens } from './useChartTokens';
import { useChartTransform, type ChartTransform } from './useChartTransform';
import { ZOOM_STEP } from './geometry';

/** What the canvas needs, and what it hands back to the shell. */
export interface ChartCanvasProps extends BaseGridParams {
  /** Whether the document is in SI, for the axis titles. */
  isSi: boolean;
  /** Receives the transform so the toolbox can drive zoom and fit. */
  onTransformReady?: (transform: ChartTransform) => void;
}

export function ChartCanvas({ isSi, onTransformReady, ...params }: ChartCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const grid = useBaseGrid(params);
  const tokens = useChartTokens();
  const transform = useChartTransform(host, grid.extent);

  const { size, viewport, pan, zoomBy } = transform;
  onTransformReady?.(transform);

  const dragging = useRef(false);

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<globalThis.WheelEvent>) => {
      e.evt.preventDefault();
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      // A wheel notch is one zoom step, anchored under the cursor so the point
      // being examined stays put rather than sliding away from it.
      zoomBy(e.evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, pointer ?? undefined);
    },
    [zoomBy],
  );

  return (
    <div
      ref={host}
      className="chart-canvas"
      onWheelCapture={(e: WheelEvent) => e.preventDefault()}
    >
      {size.width > 0 && size.height > 0 ? (
        <Stage
          width={size.width}
          height={size.height}
          onWheel={handleWheel}
          onMouseDown={() => (dragging.current = true)}
          onMouseUp={() => (dragging.current = false)}
          onMouseLeave={() => (dragging.current = false)}
          onMouseMove={(e: Konva.KonvaEventObject<globalThis.MouseEvent>) => {
            // Panning reads the raw movement deltas rather than tracking a
            // start point: no per-move allocation, and no state update that
            // would re-render the tree on the 60 FPS path.
            if (dragging.current) pan(e.evt.movementX, e.evt.movementY);
          }}
        >
          {tokens ? (
            <PsychGrid
              curves={grid.curves}
              viewport={viewport}
              tokens={tokens}
              width={size.width}
              height={size.height}
            />
          ) : null}
          {tokens ? (
            <ChartAxes
              curves={grid.curves}
              layout={params.layout}
              viewport={viewport}
              tokens={tokens}
              width={size.width}
              height={size.height}
              isSi={isSi}
            />
          ) : null}
        </Stage>
      ) : null}
    </div>
  );
}
