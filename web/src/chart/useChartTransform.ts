/**
 * The viewport hook: zoom, pan, and the canvas bounding box.
 *
 * This is the *only* place that owns view state. The grid data below it does
 * not know the viewport exists, which is the property that makes Layer 0
 * cacheable: panning changes what this hook returns and nothing else, so the
 * expensive call that produces the curves never has to run again.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  fitViewport,
  panBy,
  toChart,
  toScreen,
  zoomAbout,
  zoomLevel,
  ZOOM_STEP,
  type Extent,
  type Point,
  type Size,
  type Viewport,
} from './geometry';

/** What the viewport hook exposes. */
export interface ChartTransform {
  /** The measured canvas box. */
  size: Size;
  /** The current scale and translation. */
  viewport: Viewport;
  /** Current zoom as a multiple of the fitted view. */
  zoom: number;
  /** Chart space → screen pixels. */
  toScreen: (x: number, y: number) => Point;
  /** Screen pixels → chart space. */
  toChart: (px: number, py: number) => Point;
  /** Moves the view by a screen-space delta. */
  pan: (dx: number, dy: number) => void;
  /** Scales about a screen point, or about the canvas centre by default. */
  zoomBy: (factor: number, anchor?: Point) => void;
  /** One step in, anchored at the centre. */
  zoomIn: () => void;
  /** One step out, anchored at the centre. */
  zoomOut: () => void;
  /** Returns to the fitted view. */
  fit: () => void;
}

/**
 * Measures an element, keeping up with layout changes.
 *
 * A `ResizeObserver` rather than a window listener: the viewport changes size
 * when the properties panel opens or a pane is dragged, neither of which is a
 * window resize.
 */
function useMeasuredSize(ref: React.RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const read = () =>
      setSize((prev) => {
        const { clientWidth: width, clientHeight: height } = el;
        // Bail out when nothing moved: a ResizeObserver fires on any layout
        // pass, and a fresh object every time would re-render the whole canvas.
        return prev.width === width && prev.height === height ? prev : { width, height };
      });

    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

/**
 * Owns the mapping from chart space to the canvas.
 *
 * The view resets to fitted whenever the *extent* changes — a different unit
 * system, altitude or layout is a different chart, and holding a pan across
 * that would leave the user looking at empty space. It does **not** reset when
 * the canvas merely resizes, because a window drag should not throw away where
 * someone was looking.
 */
export function useChartTransform(
  ref: React.RefObject<HTMLElement | null>,
  extent: Extent,
): ChartTransform {
  const size = useMeasuredSize(ref);
  const fitted = useMemo(() => fitViewport(extent, size), [extent, size]);

  const [viewport, setViewport] = useState<Viewport | null>(null);

  // Reset on a new extent, keyed by value rather than identity so a freshly
  // built but equal extent object does not throw the view away.
  const extentKey = `${extent.x_min},${extent.x_max},${extent.y_min},${extent.y_max}`;
  const lastExtent = useRef(extentKey);
  useEffect(() => {
    if (lastExtent.current !== extentKey) {
      lastExtent.current = extentKey;
      setViewport(null);
    }
  }, [extentKey]);

  const active = viewport ?? fitted;

  const centre = useCallback(
    (): Point => ({ x: size.width / 2, y: size.height / 2 }),
    [size.width, size.height],
  );

  const zoomBy = useCallback(
    (factor: number, anchor?: Point) => {
      setViewport((current) =>
        zoomAbout(current ?? fitted, factor, anchor ?? centre(), fitted),
      );
    },
    [fitted, centre],
  );

  return {
    size,
    viewport: active,
    zoom: zoomLevel(active, fitted),
    toScreen: useCallback((x, y) => toScreen(active, x, y), [active]),
    toChart: useCallback((px, py) => toChart(active, px, py), [active]),
    pan: useCallback(
      (dx, dy) => setViewport((current) => panBy(current ?? fitted, dx, dy)),
      [fitted],
    ),
    zoomBy,
    zoomIn: useCallback(() => zoomBy(ZOOM_STEP), [zoomBy]),
    zoomOut: useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy]),
    fit: useCallback(() => setViewport(null), []),
  };
}
