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
import { Layer, Line, Stage } from 'react-konva';
import type Konva from 'konva';

import { ChartAxes } from './ChartAxes';
import { CrosshairLayer } from './CrosshairLayer';
import { PointLayer } from './PointLayer';
import { ProcessLayer, ProtractorLine } from './ProcessLayer';
import { PsychGrid } from './PsychGrid';
import { WeatherLayer } from './WeatherLayer';
import { ZoneLayer } from './ZoneLayer';
import { formatHud } from './format';
import { nearestWithin, toChart, ZOOM_STEP, type Viewport } from './geometry';
import { useBaseGrid, type BaseGridParams, type GridCurve } from './useBaseGrid';
import { useChartTokens, type ChartTokens } from './useChartTokens';
import { useChartTransform, type ChartTransform } from './useChartTransform';
import { useT } from '../i18n/useT';
import { state_from_chart_coordinates_clamped, type StatePointOutput } from '../psychro';
import { isCurveVisible, type FamilyStyle } from '../store/useStyleStore';
import type { CurveFamilyId } from '../psychro';
import type { ResolvedPoint } from '../store/useResolvedPoints';
import type { ResolvedProcess } from '../store/useResolvedProcesses';
import type { Envelope } from '../data';
import type { BinGrid } from '../weather/epw.worker';

/**
 * One end of a drawn process.
 *
 * Either a point that already exists, or a bare state where the pointer landed
 * — the shell decides whether that becomes a new point. The canvas resolves the
 * gesture and takes no view on the document.
 */
export interface DrawEndpoint {
  /** The point the gesture snapped to, or null for open chart. */
  pointId: string | null;
  /** Dry-bulb temperature in the document's units. */
  dryBulb: number;
  /** Humidity ratio. */
  humidityRatio: number;
}

/** How close, in pixels, the pointer has to be to snap to a marker. */
const SNAP_RADIUS = 12;

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
  /** The standards envelopes to draw beneath the points. */
  envelopes: Envelope[];
  /** Binned weather hours, or null when no file is loaded. */
  weatherBins: BinGrid | null;
  /** Which curve families are drawn. */
  visible: Record<CurveFamilyId, boolean>;
  /** The line-styling matrix: colour, dash, and width per family. */
  styles: Record<CurveFamilyId, FamilyStyle>;
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
  /**
   * Whether a press-and-drag draws a process rather than panning the view.
   *
   * The gesture the toolbox has always offered and nothing implemented: press
   * on a point, drag, release on another. It is the most direct statement of
   * "a process joins two states", and it was the one gesture missing.
   */
  drawing: boolean;
  /** Commits a drawn process between two endpoints. */
  onDrawProcess: (from: DrawEndpoint, to: DrawEndpoint) => void;
  /** Receives the transform so the toolbox can drive zoom and fit. */
  onTransformReady?: (transform: ChartTransform) => void;
  /**
   * Reports what was drawn, so an export can reproduce it.
   *
   * An export has to render the same curves at the same viewport the reader is
   * looking at; asking the canvas afterwards is the only way to be sure it is
   * the same one.
   */
  onDrawn?: (state: {
    curves: GridCurve[];
    viewport: Viewport;
    tokens: ChartTokens;
    styles: Record<CurveFamilyId, FamilyStyle>;
    width: number;
    height: number;
  }) => void;
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
  envelopes,
  weatherBins,
  visible,
  styles,
  showLabels,
  showCrosshair,
  onMovePoint,
  onSelectPoint,
  onPlacePoint,
  placing,
  drawing,
  onDrawProcess,
  onTransformReady,
  onDrawn,
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

  /**
   * The draw gesture in flight: where it started, and where the pointer is.
   *
   * State rather than a ref, because the rubber band has to be *drawn* — and a
   * ref read during render is exactly what the React compiler refuses, for the
   * good reason that the paint would then lag the pointer by one event. The
   * update costs one re-render per pointer move for the duration of one drag,
   * which is what the crosshair already does.
   */
  const [draw, setDraw] = useState<{
    from: DrawEndpoint;
    at: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);

  const curves = grid.curves.filter((c) => isCurveVisible(visible, c.family, c.value));

  if (tokens && size.width > 0) {
    onDrawn?.({
      curves,
      viewport,
      tokens,
      styles,
      width: size.width,
      height: size.height,
    });
  }

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

  /** The resolved point nearest a screen position, within the snap radius. */
  const snap = useCallback(
    (px: number, py: number): ResolvedPoint | null =>
      nearestWithin(points, (p) => p.position, viewport, px, py, SNAP_RADIUS),
    [points, viewport],
  );

  /** Turns a screen position into one end of a process. */
  const endpointAt = useCallback(
    (px: number, py: number): DrawEndpoint | null => {
      const snapped = snap(px, py);
      if (snapped?.state) {
        return {
          pointId: snapped.point.id,
          dryBulb: snapped.state.dbt,
          humidityRatio: snapped.state.humidity_ratio,
        };
      }
      const { state } = probe(px, py);
      if (!state) return null;
      return {
        pointId: null,
        dryBulb: state.dbt,
        humidityRatio: state.humidity_ratio,
      };
    },
    [snap, probe],
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
      const pointer = e.target.getStage()?.getPointerPosition();
      // The rubber band, in screen coordinates: no re-resolution of the
      // document, just a line following the pointer.
      if (draw && pointer) {
        setDraw({ ...draw, to: { x: pointer.x, y: pointer.y } });
        return;
      }
      // Panning reads the raw movement deltas rather than tracking a start
      // point: no per-move allocation, and no state update on the 60 FPS path
      // beyond the one the HUD needs.
      if (dragging.current) {
        pan(e.evt.movementX, e.evt.movementY);
        return;
      }
      if (!pointer) return;
      setHover(showCrosshair ? probe(pointer.x, pointer.y) : null);
    },
    [pan, probe, showCrosshair, draw],
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
      className={
        placing || drawing ? 'chart-canvas chart-canvas--placing' : 'chart-canvas'
      }
      onWheelCapture={(e: WheelEvent) => e.preventDefault()}
    >
      {size.width > 0 && size.height > 0 && tokens ? (
        <Stage
          width={size.width}
          height={size.height}
          onWheel={handleWheel}
          onClick={handleClick}
          onMouseDown={(e: Konva.KonvaEventObject<globalThis.MouseEvent>) => {
            const pointer = e.target.getStage()?.getPointerPosition();
            if (drawing && pointer) {
              const from = endpointAt(pointer.x, pointer.y);
              const at = { x: pointer.x, y: pointer.y };
              if (from) setDraw({ from, at, to: at });
              return;
            }
            // Dragging the view, not a point: a marker handles its own drag.
            if (e.target === e.target.getStage()) dragging.current = true;
          }}
          onMouseUp={(e: Konva.KonvaEventObject<globalThis.MouseEvent>) => {
            dragging.current = false;
            if (!draw) return;
            const pointer = e.target.getStage()?.getPointerPosition();
            setDraw(null);
            if (!pointer) return;
            // A press and release in the same spot is a click, not a process.
            // Without this, every stray click in the mode draws a zero-length
            // arrow between a point and itself.
            if (Math.hypot(pointer.x - draw.at.x, pointer.y - draw.at.y) < SNAP_RADIUS) {
              return;
            }
            const to = endpointAt(pointer.x, pointer.y);
            if (to && to.pointId !== draw.from.pointId) onDrawProcess(draw.from, to);
          }}
          onMouseLeave={() => {
            dragging.current = false;
            // Leaving the canvas abandons the gesture rather than committing it
            // to wherever the pointer happened to exit.
            setDraw(null);
            setHover(null);
          }}
          onMouseMove={handleMove}
        >
          <PsychGrid
            curves={curves}
            viewport={viewport}
            tokens={tokens}
            styles={styles}
            width={size.width}
            height={size.height}
          />
          <ZoneLayer
            envelopes={envelopes}
            viewport={viewport}
            tokens={tokens}
            layout={params.layout}
            altitudeM={params.altitudeM}
            realGas={params.realGas}
          />
          <WeatherLayer
            bins={weatherBins}
            viewport={viewport}
            tokens={tokens}
            layout={params.layout}
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
            draggable={!drawing}
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
          {/* The rubber band. Drawn above everything and listening to nothing:
              it is feedback for a gesture in flight, not an object. */}
          {draw ? (
            <Layer listening={false}>
              <Line
                points={[draw.at.x, draw.at.y, draw.to.x, draw.to.y]}
                stroke={tokens.process}
                strokeWidth={1.5}
                dash={[6, 4]}
                perfectDrawEnabled={false}
              />
            </Layer>
          ) : null}
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
