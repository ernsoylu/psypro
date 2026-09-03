/**
 * The chart-space → screen stage, tested as arithmetic.
 *
 * No canvas, no React: these are the functions the 60 FPS path calls, and the
 * properties asserted here are the ones a user would notice breaking — a zoom
 * that drifts under the cursor, a drag that does not track the pointer, a fit
 * that clips the saturation curve off the top of the chart.
 */

import { describe, expect, it } from 'vitest';

import {
  fitViewport,
  nearestWithin,
  panBy,
  projectFlat,
  toChart,
  toScreen,
  zoomAbout,
  zoomLevel,
  FIT_PADDING,
  MAX_ZOOM,
  MIN_ZOOM,
  type Extent,
  type Size,
} from './geometry';

const EXTENT: Extent = { x_min: -10, x_max: 52, y_min: 0, y_max: 0.03 };
const SIZE: Size = { width: 1000, height: 800 };

describe('fitViewport', () => {
  it('places the whole extent inside the canvas, padding included', () => {
    const v = fitViewport(EXTENT, SIZE);
    const corners = [
      toScreen(v, EXTENT.x_min, EXTENT.y_min),
      toScreen(v, EXTENT.x_max, EXTENT.y_max),
    ];
    for (const p of corners) {
      expect(p.x).toBeGreaterThanOrEqual(FIT_PADDING - 0.001);
      expect(p.x).toBeLessThanOrEqual(SIZE.width - FIT_PADDING + 0.001);
      expect(p.y).toBeGreaterThanOrEqual(FIT_PADDING - 0.001);
      expect(p.y).toBeLessThanOrEqual(SIZE.height - FIT_PADDING + 0.001);
    }
  });

  it('scales the two axes independently, because they carry different units', () => {
    const v = fitViewport(EXTENT, SIZE);
    // The reduced coordinate spans ~62 kJ/kg and humidity ratio spans 0.03
    // kg/kg. A single scale would collapse the chart to a horizontal line —
    // which is exactly what it did, on screen, before this test existed.
    expect(v.scaleY / v.scaleX).toBeGreaterThan(100);
    const drawnW = toScreen(v, EXTENT.x_max, 0).x - toScreen(v, EXTENT.x_min, 0).x;
    const drawnH = toScreen(v, 0, EXTENT.y_min).y - toScreen(v, 0, EXTENT.y_max).y;
    expect(drawnW).toBeCloseTo(SIZE.width - 2 * FIT_PADDING, 6);
    expect(drawnH).toBeCloseTo(SIZE.height - 2 * FIT_PADDING, 6);
  });

  it('inverts the vertical axis, once', () => {
    const v = fitViewport(EXTENT, SIZE);
    // Humidity ratio grows upward on the chart and downward on the screen.
    expect(toScreen(v, 0, EXTENT.y_max).y).toBeLessThan(toScreen(v, 0, EXTENT.y_min).y);
  });

  it('fills the canvas to the padding on both axes', () => {
    const v = fitViewport(EXTENT, SIZE);
    expect(toScreen(v, EXTENT.x_min, 0).x).toBeCloseTo(FIT_PADDING, 6);
    expect(toScreen(v, EXTENT.x_max, 0).x).toBeCloseTo(SIZE.width - FIT_PADDING, 6);
    expect(toScreen(v, 0, EXTENT.y_max).y).toBeCloseTo(FIT_PADDING, 6);
    expect(toScreen(v, 0, EXTENT.y_min).y).toBeCloseTo(SIZE.height - FIT_PADDING, 6);
  });

  it('stays finite on a degenerate extent', () => {
    // A zero-width domain is a bad input, not a crash: an infinity here would
    // propagate into every projected point and blank the canvas.
    const v = fitViewport({ x_min: 5, x_max: 5, y_min: 0, y_max: 0 }, SIZE);
    expect(Number.isFinite(v.scaleX)).toBe(true);
    expect(Number.isFinite(v.scaleY)).toBe(true);
    expect(Number.isFinite(v.offsetX)).toBe(true);
  });
});

describe('the two directions invert each other', () => {
  it('round-trips chart → screen → chart', () => {
    const v = fitViewport(EXTENT, SIZE);
    for (const [x, y] of [
      [-10, 0],
      [24, 0.0093],
      [52, 0.03],
    ] as const) {
      const p = toScreen(v, x, y);
      const back = toChart(v, p.x, p.y);
      expect(back.x).toBeCloseTo(x, 9);
      expect(back.y).toBeCloseTo(y, 12);
    }
  });

  it('projects a flat run exactly as toScreen would', () => {
    const v = fitViewport(EXTENT, SIZE);
    const flat = [0, 0, 24, 0.0093, 40, 0.02];
    const projected = projectFlat(v, flat);
    for (let i = 0; i < flat.length; i += 2) {
      const p = toScreen(v, flat[i]!, flat[i + 1]!);
      expect(projected[i]).toBeCloseTo(p.x, 9);
      expect(projected[i + 1]).toBeCloseTo(p.y, 9);
    }
  });
});

describe('zoom and pan', () => {
  it('keeps the anchor point fixed under the cursor', () => {
    const v = fitViewport(EXTENT, SIZE);
    const anchor = { x: 300, y: 500 };
    const under = toChart(v, anchor.x, anchor.y);

    const zoomed = zoomAbout(v, 2, anchor, v);
    const stillUnder = toChart(zoomed, anchor.x, anchor.y);

    // This is the difference between "zooming toward the cursor" and "the chart
    // sliding away from it", which is what a wheel gesture feels like when the
    // anchor is dropped.
    expect(stillUnder.x).toBeCloseTo(under.x, 9);
    expect(stillUnder.y).toBeCloseTo(under.y, 12);
    expect(zoomed.scaleX).toBeCloseTo(v.scaleX * 2, 9);
  });

  it('keeps the fitted aspect ratio through any sequence of zooms', () => {
    const v = fitViewport(EXTENT, SIZE);
    const ratio = v.scaleY / v.scaleX;

    let z = v;
    for (const [factor, anchor] of [
      [2, { x: 10, y: 700 }],
      [0.4, { x: 900, y: 50 }],
      [1.7, { x: 500, y: 400 }],
    ] as const) {
      z = zoomAbout(z, factor, anchor, v);
      // The SHR protractor reads its angles against the chart's own axes, so
      // this ratio drifting is the protractor going quietly wrong.
      expect(z.scaleY / z.scaleX).toBeCloseTo(ratio, 9);
    }
  });

  it('clamps to the zoom bounds instead of running away', () => {
    const v = fitViewport(EXTENT, SIZE);
    const anchor = { x: 500, y: 400 };

    let far = v;
    for (let i = 0; i < 80; i += 1) far = zoomAbout(far, 2, anchor, v);
    expect(zoomLevel(far, v)).toBeCloseTo(MAX_ZOOM, 6);

    let near = v;
    for (let i = 0; i < 80; i += 1) near = zoomAbout(near, 0.5, anchor, v);
    expect(zoomLevel(near, v)).toBeCloseTo(MIN_ZOOM, 6);
  });

  it('returns the same object when a zoom would change nothing', () => {
    const v = fitViewport(EXTENT, SIZE);
    const capped = zoomAbout(v, MAX_ZOOM * 4, { x: 0, y: 0 }, v);
    // Identity, so a wheel event at the stop does not re-render the canvas.
    expect(zoomAbout(capped, 2, { x: 0, y: 0 }, v)).toBe(capped);
  });

  it('moves the view by exactly the pointer delta', () => {
    const v = fitViewport(EXTENT, SIZE);
    const before = toScreen(v, 24, 0.0093);
    const after = toScreen(panBy(v, 37, -12), 24, 0.0093);
    expect(after.x - before.x).toBeCloseTo(37, 9);
    expect(after.y - before.y).toBeCloseTo(-12, 9);
  });

  it('does not change scale when panning', () => {
    const v = fitViewport(EXTENT, SIZE);
    expect(panBy(v, 100, 100).scaleX).toBe(v.scaleX);
    expect(panBy(v, 100, 100).scaleY).toBe(v.scaleY);
  });
});

describe('snapping a drawn process to a point', () => {
  const v = fitViewport(EXTENT, SIZE);
  const points = [
    { id: 'a', position: { x: 20, y: 0.008 } },
    { id: 'b', position: { x: 30, y: 0.012 } },
    { id: 'gone', position: null },
  ];
  const at = (id: string) => {
    const point = points.find((p) => p.id === id)!.position!;
    return toScreen(v, point.x, point.y);
  };

  it('snaps to a marker the pointer is on', () => {
    const target = at('b');
    const hit = nearestWithin(
      points,
      (p) => p.position,
      v,
      target.x + 3,
      target.y - 2,
      12,
    );
    expect(hit?.id).toBe('b');
  });

  it('snaps to nothing outside the radius, however empty the chart is', () => {
    // A preference rather than a limit is the bug this guards: with only two
    // points on the chart, "nearest" would otherwise reach halfway across it and
    // silently join a process to the wrong state.
    const target = at('a');
    expect(
      nearestWithin(points, (p) => p.position, v, target.x + 40, target.y, 12),
    ).toBeNull();
  });

  it('takes the closer of two markers within the radius', () => {
    const a = at('a');
    const b = at('b');
    const between = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const hit = nearestWithin(
      points,
      (p) => p.position,
      v,
      between.x + (a.x - b.x) * 0.02,
      between.y,
      Math.hypot(a.x - b.x, a.y - b.y),
    );
    expect(hit?.id).toBe('a');
  });

  it('ignores a point that did not resolve', () => {
    // A supersaturated point has no position, and snapping to it would join a
    // process to a state that does not exist.
    expect(nearestWithin([points[2]!], (p) => p.position, v, 100, 100, 1000)).toBeNull();
  });
});
