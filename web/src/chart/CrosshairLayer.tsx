/**
 * Layer 4 — the HUD: a crosshair on the pointer with a live property readout.
 *
 * This is the layer that makes a psychrometric chart teach rather than merely
 * display. Reading a wet-bulb off a printed chart means following a dashed line
 * by eye to a scale at the edge; here the number is under the cursor. Students
 * are the audience `REQUIREMENTS.md` §0 names, and this is the feature that
 * serves them most directly.
 *
 * It sits above everything and listens for nothing: pointer tracking happens on
 * the stage, so the HUD never intercepts a click meant for a point.
 */

import { Group, Layer, Line, Rect, Text } from 'react-konva';

import { toScreen, type Viewport } from './geometry';
import type { ChartTokens } from './useChartTokens';
import type { StatePointOutput } from '../psychro';

/** One line of the tooltip. */
export interface HudRow {
  label: string;
  value: string;
}

/** What the HUD needs. */
export interface CrosshairLayerProps {
  /** Where the pointer is, in chart space, or null when it has left. */
  at: { x: number; y: number } | null;
  /** The state under the pointer, if it resolved to one. */
  state: StatePointOutput | null;
  /** The rows to show, already formatted and translated. */
  rows: HudRow[];
  /** The chart-space → screen mapping. */
  viewport: Viewport;
  /** The resolved palette. */
  tokens: ChartTokens;
  /** The canvas box, so the tooltip can flip rather than run off the edge. */
  width: number;
  height: number;
}

const TOOLTIP_WIDTH = 176;
const ROW_HEIGHT = 17;
const PADDING = 8;
const FONT_SIZE = 10.5;
const NODE_RADIUS = 4;

export function CrosshairLayer({
  at,
  state,
  rows,
  viewport,
  tokens,
  width,
  height,
}: CrosshairLayerProps) {
  if (!at) return null;

  const { x, y } = toScreen(viewport, at.x, at.y);
  const boxHeight = rows.length * ROW_HEIGHT + PADDING * 2;

  // Flip the tooltip toward whichever side has room, so it never runs off the
  // canvas — the readout is the point of the HUD, and a clipped one is useless.
  const left = x + 14 + TOOLTIP_WIDTH > width ? x - 14 - TOOLTIP_WIDTH : x + 14;
  const top = Math.min(Math.max(y - boxHeight / 2, 4), Math.max(height - boxHeight - 4, 4));

  return (
    <Layer listening={false}>
      <Line
        points={[0, y, width, y]}
        stroke={tokens.axis}
        strokeWidth={0.75}
        dash={[3, 3]}
        opacity={0.7}
        perfectDrawEnabled={false}
      />
      <Line
        points={[x, 0, x, height]}
        stroke={tokens.axis}
        strokeWidth={0.75}
        dash={[3, 3]}
        opacity={0.7}
        perfectDrawEnabled={false}
      />
      {state ? (
        <Group>
          <Rect
            x={left}
            y={top}
            width={TOOLTIP_WIDTH}
            height={boxHeight}
            fill={tokens.background}
            stroke={tokens.axis}
            strokeWidth={1}
            cornerRadius={4}
            opacity={0.97}
            perfectDrawEnabled={false}
          />
          {rows.map((row, i) => (
            <Group key={row.label}>
              <Text
                x={left + PADDING}
                y={top + PADDING + i * ROW_HEIGHT}
                text={row.label}
                fontSize={FONT_SIZE}
                fill={tokens.axis}
                perfectDrawEnabled={false}
              />
              <Text
                x={left}
                y={top + PADDING + i * ROW_HEIGHT}
                width={TOOLTIP_WIDTH - PADDING}
                align="right"
                text={row.value}
                fontSize={FONT_SIZE}
                fontFamily="monospace"
                fill={tokens.text}
                perfectDrawEnabled={false}
              />
            </Group>
          ))}
        </Group>
      ) : null}
      <Line
        points={[x - NODE_RADIUS, y, x + NODE_RADIUS, y]}
        stroke={tokens.text}
        strokeWidth={1.5}
        perfectDrawEnabled={false}
      />
      <Line
        points={[x, y - NODE_RADIUS, x, y + NODE_RADIUS]}
        stroke={tokens.text}
        strokeWidth={1.5}
        perfectDrawEnabled={false}
      />
    </Layer>
  );
}
