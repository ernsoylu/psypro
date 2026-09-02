/**
 * The Phase 5 exit criterion: Layer 0 is generated once and not per frame.
 *
 * `generate_base_grid` walks six curve families and solves a wet-bulb inversion
 * per sampled point. It is a WASM round trip, and putting it inside a pan
 * gesture is the single easiest way to turn a smooth chart into a stuttering
 * one. The rule is easy to state, invisible when broken on a fast machine, and
 * trivially reintroduced by a refactor — so it is counted here rather than
 * asserted in a comment.
 *
 * The other half matters just as much: the grid MUST regenerate when the
 * physics behind it changes. A cache that never invalidates would draw a
 * sea-level chart for a site in Denver, which is worse than a slow one.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let gridCalls = 0;

vi.mock('../psychro', () => {
  const ChartLayout = { Ashrae: 0, MollierIx: 1 } as const;
  const CurveFamilyId = {
    DryBulb: 0,
    HumidityRatio: 1,
    RelativeHumidity: 2,
    WetBulb: 3,
    Enthalpy: 4,
    SpecificVolume: 5,
  } as const;
  return {
    ChartLayout,
    CurveFamilyId,
    generate_base_grid: () => {
      gridCalls += 1;
      return [
        { family: 2, value: 1, coords: [0, 0, 30, 0.03] },
        { family: 0, value: 25, coords: [25, 0, 25, 0.02] },
      ];
    },
    get_chart_extent: () => ({ x_min: -10, x_max: 52, y_min: 0, y_max: 0.03 }),
  };
});

const { useBaseGrid, DEFAULT_DOMAIN } = await import('./useBaseGrid');
const { useChartTransform } = await import('./useChartTransform');

/** The hook pair as the canvas mounts them, over a fixed 800x600 box. */
function useCanvas(altitudeM: number, layout: number) {
  const ref = {
    current: { clientWidth: 800, clientHeight: 600 } as unknown as HTMLElement,
  };
  const grid = useBaseGrid({
    domain: DEFAULT_DOMAIN,
    layout: layout as never,
    altitudeM,
    realGas: true,
  });
  return { grid, transform: useChartTransform(ref, grid.extent) };
}

beforeEach(() => {
  gridCalls = 0;
});

describe('Layer 0 caching', () => {
  it('generates the grid once on mount', () => {
    renderHook(() => useCanvas(0, 0));
    expect(gridCalls).toBe(1);
  });

  it('does not regenerate across a pan', () => {
    const { result } = renderHook(() => useCanvas(0, 0));
    const curves = result.current.grid.curves;

    for (let i = 0; i < 30; i += 1) {
      act(() => result.current.transform.pan(4, -3));
    }

    expect(gridCalls).toBe(1);
    // Identity, not just equality: the renderer keys its Konva cache off this
    // array, so a fresh one every pan would repaint every line.
    expect(result.current.grid.curves).toBe(curves);
  });

  it('does not regenerate across a zoom', () => {
    const { result } = renderHook(() => useCanvas(0, 0));

    act(() => result.current.transform.zoomIn());
    act(() => result.current.transform.zoomBy(1.4, { x: 120, y: 90 }));
    act(() => result.current.transform.zoomOut());
    act(() => result.current.transform.fit());

    expect(gridCalls).toBe(1);
  });

  it('moves the view even though it did not regenerate', () => {
    const { result } = renderHook(() => useCanvas(0, 0));
    const before = result.current.transform.toScreen(24, 0.0093);

    act(() => result.current.transform.pan(50, 25));

    const after = result.current.transform.toScreen(24, 0.0093);
    // Guards the test itself: a pan that silently did nothing would satisfy the
    // call count for the wrong reason.
    expect(after.x - before.x).toBeCloseTo(50, 6);
    expect(after.y - before.y).toBeCloseTo(25, 6);
  });

  it('regenerates when altitude changes, because the physics did', () => {
    const { rerender } = renderHook(({ alt }) => useCanvas(alt, 0), {
      initialProps: { alt: 0 },
    });
    expect(gridCalls).toBe(1);
    rerender({ alt: 1609 });
    expect(gridCalls).toBe(2);
  });

  it('regenerates when the layout changes, because the geometry did', () => {
    const { rerender } = renderHook(({ layout }) => useCanvas(0, layout), {
      initialProps: { layout: 0 },
    });
    expect(gridCalls).toBe(1);
    rerender({ layout: 1 });
    expect(gridCalls).toBe(2);
  });

  it('does not regenerate when only the caller re-renders', () => {
    const { rerender } = renderHook(() => useCanvas(0, 0));
    // The canvas rebuilds its params object on every render; the hook takes the
    // dependency list field by field so that does not defeat the cache.
    for (let i = 0; i < 10; i += 1) rerender();
    expect(gridCalls).toBe(1);
  });
});
