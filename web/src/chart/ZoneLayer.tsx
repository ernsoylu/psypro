/**
 * Layer 1 — the standards overlays.
 *
 * Beneath the points and above the grid, which is the §7 order and also the
 * useful one: a zone is context for the states drawn on it, so it must not
 * obscure them, and it must not be lost under the gridlines either.
 *
 * The polygons are computed by the engine at the document's own altitude rather
 * than stored. A relative-humidity bound is a curve whose shape depends on
 * barometric pressure, so an outline traced once at sea level is wrong in Denver
 * — and wrong invisibly, which is worse.
 */

import { useMemo } from 'react';
import { Layer, Line } from 'react-konva';

import { projectFlat, type Viewport } from './geometry';
import { envelope_polygon, ChartLayout } from '../psychro';
import type { Envelope } from '../data';
import type { ChartTokens } from './useChartTokens';

/** What the zone layer needs. */
export interface ZoneLayerProps {
  /** The envelopes to draw. */
  envelopes: Envelope[];
  /** The chart-space → screen mapping. */
  viewport: Viewport;
  /** The resolved palette. */
  tokens: ChartTokens;
  /** Which construction the chart is drawn in. */
  layout: ChartLayout;
  /** Elevation as the document expresses it. */
  altitude: number;
  /** Whether the document is in SI. */
  isSi: boolean;
  /** Whether the real-gas enhancement factor is applied. */
  realGas: boolean;
}

/** `NaN` is how the boundary says "the standard does not state this bound". */
const UNBOUNDED = Number.NaN;

export function ZoneLayer({
  envelopes,
  viewport,
  tokens,
  layout,
  altitude,
  isSi,
  realGas,
}: ZoneLayerProps) {
  // Memoised on everything that moves a polygon — which is the physics, not the
  // view. Panning and zooming reproject the same chart-space vertices.
  const polygons = useMemo(
    () =>
      envelopes.map((envelope) => {
        const l = envelope.limits;
        return {
          id: envelope.id,
          colorVar: envelope.colorVar,
          coords: envelope_polygon(
            l.tMin,
            l.tMax,
            l.dpMin ?? UNBOUNDED,
            l.dpMax ?? UNBOUNDED,
            l.rhMin ?? UNBOUNDED,
            l.rhMax ?? UNBOUNDED,
            l.wMin ?? UNBOUNDED,
            l.wMax ?? UNBOUNDED,
            layout,
            altitude,
            isSi,
            realGas,
          ),
        };
      }),
    [envelopes, layout, altitude, isSi, realGas],
  );

  return (
    <Layer listening={false}>
      {polygons.map((p) => {
        // An envelope that does not exist at this pressure draws as nothing,
        // which is the honest rendering — better than a shape in the wrong
        // place.
        if (p.coords.length < 6) return null;
        const fill =
          p.colorVar === '--chart-zone-comfort'
            ? tokens.zoneComfort
            : tokens.zoneDatacenter;
        return (
          <Line
            key={p.id}
            points={projectFlat(viewport, p.coords)}
            closed
            fill={fill}
            stroke={fill}
            strokeWidth={1}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })}
    </Layer>
  );
}
