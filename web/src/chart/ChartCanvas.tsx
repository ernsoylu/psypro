/**
 * The chart canvas: the Konva stage and the layer pipeline.
 *
 * The layers mount in the Z-order `REQUIREMENTS.md` §7 specifies, each as its
 * own component, so adding a visual layer never means touching an existing one:
 *
 * ```
 * 0  base grid       cached, regenerated only on units / altitude / layout
 * 1  data zones      Phase 9
 * 2  weather bins    Phase 10
 * 3  active elements state points and process lines
 * 4  HUD             crosshair and live readout
 * ```
 *
 * Pointer handling lives here rather than inside a layer because a drag of the
 * *view* is a property of the view, and the crosshair follows the stage rather
 * than anything drawn on it.
 */

import { useCallback, useRef, useState, type WheelEvent } from 'react';
import { Layer, Stage } from 'react-konva';
import type Konva from 'konva';

import { ChartAxes } from './ChartAxes';
import { CrosshairLayer } from './CrosshairLayer';
import { PointLayer } from './PointLayer';
import { ProcessLayer, ProtractorLine } from './ProcessLayer';
import { PsychGrid } from './PsychGrid';
import { formatHud } from './format';
import { toChart, ZOOM_STEP } from './geometry';
import { useBaseGrid, type BaseGridParams } from './useBaseGrid';
import { useChartTokens } from './useChartTokens';
import { useChartTransform, type ChartTransform } from './useChartTransform';
import { useT } from '../i18n/useT';
import { state_from_chart_coordinates_clamped, type StatePointOutput } from '../psychro';
import { isCurveVisible } from '../store/useStyleStore';
import type { CurveFamilyId } from '../psychro';
import type { ResolvedPoint } from '../store/useResolvedPoints';
import type { ResolvedProcess } from '../store/useResolvedProcesses';

/** What the canvas needs, and what it hands back to the shell. */
export interface ChartCanvasProps extends BaseGridParams {
  /** Whether the document is in SI, for the axis titles and the readout. */
  isSi: boolean;
  /** Elevation as the document expresses it, for the inverse resolution. */
  altitude: number;
  /** The document's points, already resolved. */
  points: ResolvedPoint[];
  /** Which point is selected. */
  selectedId: string | null;
  /** The document's processes, already resolved. */
  processes: ResolvedProcess[];
  /** Which process is selected. */
  selectedProcessId: string | null;
  /** Selects a process. */
  onSelectProcess: (id: string) => void;
  /**
   * The SHR reference line to draw, or null for none.
   *
   * `slope: null` inside a present object means SHR = 1 — a horizontal line —
   * which is different from drawing nothing.
   */
  protractor: { slope: number | null; through: { x: number; y: number } } | null;
  /** Which curve families are drawn. */
  visible: Record<CurveFamilyId, boolean>;
  /** Whether the numerals are drawn. */
  showLabels: boolean;
  /** Whether the crosshair follows the pointer. */
  showCrosshair: boolean;
  /** Commits a dragged point's new position. */
  onMovePoint: (id: string, dryBulb: number, humidityRatio: number) => void;
  /** Selects a point. */
  onSelectPoint: (id: string) => void;
  /** Places a new point where the chart was clicked. */
  onPlacePoint: (dryBulb: number, humidityRatio: number) => void;
  /** Whether a click on empty chart places a point. */
  placing: boolean;
  /** Receives the transform so the toolbox can drive zoom and fit. */
  onTransformReady?: (transform: ChartTransform) => void;
}

export function ChartCanvas({
  isSi,
  altitude,
  points,
  selectedId,
  processes,
  selectedProcessId,
  onSelectProcess,
  protractor,
  visible,
  showLabels,
  showCrosshair,
  onMovePoint,
  onSelectPoint,
  onPlacePoint,
  placing,
  onTransformReady,
  ...params
}: ChartCanvasProps) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const grid = useBaseGrid(params);
  const tokens = useChartTokens();
  const transform = useChartTransform(host, grid.extent);

  const { size, viewport, pan, zoomBy } = transform;
  onTransformReady?.(transform);

  const dragging = useRef(false);
  const [hover, setHover] = useState<{
    at: { x: number; y: number };
    state: StatePointOutput | null;
  } | null>(null);

  const curves = grid.curves.filter((c) => isCurveVisible(visible, c.family, c.value));

  /** Chart-space position and resolved state under a screen point. */
  const probe = useCallback(
    (px: number, py: number) => {
      const at = toChart(viewport, px, py);
      try {
        const resolved = state_from_chart_coordinates_clamped(
          at.x,
          at.y,
          params.layout,
          altitude,
          isSi,
          params.realGas,
        );
        // A clamped probe would report the saturation state for a pointer that
        // is nowhere near it, so the HUD shows nothing outside the physical
        // region rather than a number that is not where the cursor is.
        return { at, state: resolved.clamped ? null : resolved.state };
      } catch {
        return { at, state: null };
      }
    },
    [viewport, params.layout, params.realGas, altitude, isSi],
  );

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<globalThis.WheelEvent>) => {
      e.evt.preventDefault();
      const pointer = e.target.getStage()?.getPointerPosition();
      // A wheel notch is one zoom step, anchored under the cursor so the point
      // being examined stays put rather than sliding away from it.
      zoomBy(e.evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, pointer ?? undefined);
    },
    [zoomBy],
  );

  const handleMove = useCallback(
    (e: Konva.KonvaEventObject<globalThis.MouseEvent>) => {
      // Panning reads the raw movement deltas rather than tracking a start
      // point: no per-move allocation, and no state update on the 60 FPS path
      // beyond the one the HUD needs.
      if (dragging.current) {
        pan(e.evt.movementX, e.evt.movementY);
        return;
      }
      const pointer = e.target.getStage()?.getPointerPosition();
      if (!pointer) return;
      setHover(showCrosshair ? probe(pointer.x, pointer.y) : null);
    },
    [pan, probe, showCrosshair],
  );

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<globalThis.MouseEvent>) => {
      // Only an empty patch of chart places a point; a click on a marker is a
      // selection, and Konva reports the marker as the target for that.
      const stage = e.target.getStage();
      if (!placing || !stage || e.target !== stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const { state } = probe(pointer.x, pointer.y);
      if (state) onPlacePoint(state.dbt, state.humidity_ratio);
    },
    [placing, probe, onPlacePoint],
  );

  return (
    <div
      ref={host}
      className={placing ? 'chart-canvas chart-canvas--placing' : 'chart-canvas'}
      onWheelCapture={(e: WheelEvent) => e.preventDefault()}
    >
      {size.width > 0 && size.height > 0 && tokens ? (
        <Stage
          width={size.width}
          height={size.height}
          onWheel={handleWheel}
          onClick={handleClick}
          onMouseDown={(e: Konva.KonvaEventObject<globalThis.MouseEvent>) => {
            // Dragging the view, not a point: a marker handles its own drag.
            if (e.target === e.target.getStage()) dragging.current = true;
          }}
          onMouseUp={() => (dragging.current = false)}
          onMouseLeave={() => {
            dragging.current = false;
            setHover(null);
          }}
          onMouseMove={handleMove}
        >
          <PsychGrid
            curves={curves}
            viewport={viewport}
            tokens={tokens}
            width={size.width}
            height={size.height}
          />
          {showLabels ? (
            <ChartAxes
              curves={curves}
              layout={params.layout}
              viewport={viewport}
              tokens={tokens}
              width={size.width}
              height={size.height}
              isSi={isSi}
            />
          ) : null}
          <ProcessLayer
            processes={processes}
            selectedId={selectedProcessId}
            viewport={viewport}
            tokens={tokens}
            onSelect={onSelectProcess}
          />
          <PointLayer
            points={points}
            selectedId={selectedId}
            viewport={viewport}
            tokens={tokens}
            layout={params.layout}
            altitude={altitude}
            isSi={isSi}
            realGas={params.realGas}
            onMove={onMovePoint}
            onSelect={onSelectPoint}
          />
          {protractor ? (
            <Layer listening={false}>
              <ProtractorLine
                slope={protractor.slope}
                layout={params.layout}
                through={protractor.through}
                viewport={viewport}
                tokens={tokens}
                width={size.width}
                height={size.height}
              />
            </Layer>
          ) : null}
          {showCrosshair ? (
            <CrosshairLayer
              at={hover?.at ?? null}
              state={hover?.state ?? null}
              rows={hover?.state ? formatHud(hover.state, isSi, t) : []}
              viewport={viewport}
              tokens={tokens}
              width={size.width}
              height={size.height}
            />
          ) : null}
        </Stage>
      ) : null}
    </div>
  );
}
