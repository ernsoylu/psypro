/**
 * Chart space → screen pixels: the second of the two coordinate stages.
 *
 * The first stage — physical properties to the oblique chart axes — happens in
 * WASM, and this one never touches thermodynamics. Keeping them apart is what
 * lets the chart layout change without the renderer knowing, and the zoom
 * behaviour change without risking the geometry.
 *
 * Everything here is a plain function over plain numbers. The React hook that
 * owns the viewport state is in `useChartTransform.ts`; this file is what that
 * hook is a wrapper around, and what the tests exercise directly.
 */

/** The chart-space region a domain occupies, as WASM reports it. */
export interface Extent {
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
}

/** The canvas box, in CSS pixels. */
export interface Size {
  width: number;
  height: number;
}

/**
 * Where the chart sits on screen: a scale per axis, and a translation.
 *
 * **Per axis, not uniform.** The two chart-space axes carry different physical
 * quantities — the reduced coordinate in kJ/kg_da against humidity ratio in
 * kg/kg_da — and they differ by three orders of magnitude over a comfort-range
 * domain. A single scale collapses the chart to a horizontal line, which is
 * exactly what it did before this was written down.
 *
 * The invariant that *does* matter is that zooming multiplies both axes by the
 * same factor, so the aspect ratio a fit establishes never changes afterwards.
 * That is what keeps the SHR protractor readable: its angles are measured
 * against the chart's own axes, so they stay correct under any zoom, and would
 * not survive the axes being scaled independently by a gesture.
 */
export interface Viewport {
  /** Pixels per chart-space unit, horizontally. */
  scaleX: number;
  /** Pixels per chart-space unit, vertically. */
  scaleY: number;
  /** Screen x of chart-space x = 0. */
  offsetX: number;
  /** Screen y of chart-space y = 0. */
  offsetY: number;
}

/** A point in either space. */
export interface Point {
  x: number;
  y: number;
}

/**
 * How much of the canvas stays clear around the plotted region.
 *
 * Wide enough for the axis numerals, which are drawn outside the domain: a
 * dry-bulb tick sits below the driest edge and a humidity-ratio tick beyond the
 * warmest, so a tight fit would clip both.
 */
export const FIT_PADDING = 34;

/** Zoom bounds, as a multiple of the fitted scale. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 40;

/** One zoom step, for the toolbox buttons and a wheel notch. */
export const ZOOM_STEP = 1.25;

/**
 * The viewport that fits `extent` inside `size`.
 *
 * Chart-space y grows upward (humidity ratio increases with height on an
 * ASHRAE chart) while screen y grows downward, so the vertical axis is
 * inverted here — the one place in the codebase where that flip happens.
 */
export function fitViewport(extent: Extent, size: Size): Viewport {
  const spanX = extent.x_max - extent.x_min;
  const spanY = extent.y_max - extent.y_min;
  const usableW = Math.max(size.width - 2 * FIT_PADDING, 1);
  const usableH = Math.max(size.height - 2 * FIT_PADDING, 1);

  // A degenerate span means there is nothing to fit; a scale of 1 keeps the
  // arithmetic finite rather than propagating an infinity into every point.
  const scaleX = spanX > 0 ? usableW / spanX : 1;
  const scaleY = spanY > 0 ? usableH / spanY : 1;

  return {
    scaleX,
    scaleY,
    offsetX: FIT_PADDING - extent.x_min * scaleX,
    offsetY: FIT_PADDING + extent.y_max * scaleY,
  };
}

/** Chart space → screen pixels. */
export function toScreen(v: Viewport, x: number, y: number): Point {
  return { x: x * v.scaleX + v.offsetX, y: v.offsetY - y * v.scaleY };
}

/** Screen pixels → chart space. Exact inverse of {@link toScreen}. */
export function toChart(v: Viewport, px: number, py: number): Point {
  return { x: (px - v.offsetX) / v.scaleX, y: (v.offsetY - py) / v.scaleY };
}

/**
 * Projects a flat `[x0, y0, x1, y1, …]` chart-space run into screen pixels.
 *
 * Flat in and flat out because that is the shape Konva's `Line` wants and the
 * shape WASM hands over, so the 60 FPS path never allocates a point object per
 * vertex. This function is called once per curve per frame; the allocation it
 * does make is the one array Konva is going to hold anyway.
 */
export function projectFlat(v: Viewport, coords: Float64Array | number[]): number[] {
  const out = new Array<number>(coords.length);
  for (let i = 0; i < coords.length; i += 2) {
    out[i] = (coords[i] ?? 0) * v.scaleX + v.offsetX;
    out[i + 1] = v.offsetY - (coords[i + 1] ?? 0) * v.scaleY;
  }
  return out;
}

/** Moves the viewport by a screen-space delta. */
export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy };
}

/**
 * Scales about a screen point, which stays put.
 *
 * Anchoring the zoom is what makes a wheel gesture feel like the chart is being
 * pulled toward the cursor rather than drifting under it. `fitted` bounds the
 * result so a scroll cannot leave the chart a sub-pixel smudge or a single
 * enormous gridline.
 */
export function zoomAbout(
  v: Viewport,
  factor: number,
  anchor: Point,
  fitted: Viewport,
): Viewport {
  // Both axes take the same factor, so the aspect ratio the fit established
  // survives every gesture. Clamping on the horizontal alone is enough for the
  // same reason: the two stay in fixed proportion.
  const level = Math.min(
    Math.max((v.scaleX * factor) / fitted.scaleX, MIN_ZOOM),
    MAX_ZOOM,
  );
  const scaleX = fitted.scaleX * level;
  const scaleY = fitted.scaleY * level;
  if (scaleX === v.scaleX) return v;

  // Solve for the offsets that leave `anchor` mapping to the same chart point.
  const before = toChart(v, anchor.x, anchor.y);
  return {
    scaleX,
    scaleY,
    offsetX: anchor.x - before.x * scaleX,
    offsetY: anchor.y + before.y * scaleY,
  };
}

/** The zoom level relative to the fitted view, for display and for tests. */
export function zoomLevel(v: Viewport, fitted: Viewport): number {
  return fitted.scaleX > 0 ? v.scaleX / fitted.scaleX : 1;
}
