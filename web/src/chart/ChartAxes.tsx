/**
 * The numerals and axis titles, on their own cached layer.
 *
 * Separate from `PsychGrid` because text and paths cache differently: Konva
 * rasterises a cached layer once, and mixing a hundred vector curves with fifty
 * text nodes in one bitmap means any change to either repaints both. Two layers
 * is also what REQUIREMENTS §7 asks for structurally — a layer is a thing you
 * can turn off, and "labels off" is a real chart option.
 */

import { useEffect, useRef } from 'react';
import { Layer, Text } from 'react-konva';
import type Konva from 'konva';

import { chartLabels } from './axes';
import { projectFlat, type Viewport } from './geometry';
import { useT } from '../i18n/useT';
import { ChartLayout } from '../psychro';
import type { GridCurve } from './useBaseGrid';
import type { ChartTokens } from './useChartTokens';

/** What the label layer needs to paint itself. */
export interface ChartAxesProps {
  curves: GridCurve[];
  layout: ChartLayout;
  viewport: Viewport;
  tokens: ChartTokens;
  width: number;
  height: number;
  /** Whether the document is in SI, which is all the titles need to know. */
  isSi: boolean;
}

/** Numeral size, in pixels. Small enough to sit between gridlines. */
const FONT_SIZE = 10;

/** Nominal width used to centre a numeral about its anchor. */
const LABEL_BOX = 48;

/** How far an axis title sits from the canvas edge, in pixels. */
const TITLE_INSET = 12;

export function ChartAxes({
  curves,
  layout,
  viewport,
  tokens,
  width,
  height,
  isSi,
}: ChartAxesProps) {
  const t = useT();
  const layer = useRef<Konva.Layer>(null);
  const labels = chartLabels(curves, layout);

  // The two axis titles, placed in screen space rather than chart space: they
  // describe the edge of the canvas, not a position on the chart, so they must
  // not move when the view pans.
  const ashrae = layout === ChartLayout.Ashrae;
  const titles = [
    {
      key: 'x',
      text: ashrae
        ? t('axis.dryBulb', { unit: isSi ? '°C' : '°F' })
        : t('axis.humidityRatio'),
      x: 0,
      y: height - TITLE_INSET,
      width,
      rotation: 0,
    },
    {
      key: 'y',
      text: ashrae
        ? t('axis.humidityRatio')
        : t('axis.dryBulb', { unit: isSi ? '°C' : '°F' }),
      x: width - TITLE_INSET,
      y: height,
      width: height,
      rotation: -90,
    },
  ];

  useEffect(() => {
    const node = layer.current;
    if (!node || width <= 0 || height <= 0) return;
    node.clearCache();
    node.cache({ pixelRatio: window.devicePixelRatio || 1 });
    node.batchDraw();
  }, [curves, layout, viewport, tokens, width, height]);

  return (
    <Layer ref={layer} listening={false}>
      {labels.map((label) => {
        const [px = 0, py = 0] = projectFlat(viewport, [label.x, label.y]);
        // Konva positions text by its top-left corner, so an alignment has to
        // be expressed as a box the text is aligned inside.
        const left =
          label.align === 'center'
            ? px - LABEL_BOX / 2
            : label.align === 'right'
              ? px - LABEL_BOX
              : px;
        return (
          <Text
            key={label.key}
            x={left + label.dx}
            y={py + label.dy - FONT_SIZE / 2}
            width={LABEL_BOX}
            align={label.align}
            text={label.text}
            fontSize={FONT_SIZE}
            fontFamily="monospace"
            fill={tokens.family[label.family]}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })}
      {titles.map((title) => (
        <Text
          key={title.key}
          x={title.x}
          y={title.y}
          width={title.width}
          rotation={title.rotation}
          align="center"
          text={title.text}
          fontSize={FONT_SIZE}
          fontFamily="monospace"
          letterSpacing={1}
          fill={tokens.axis}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
    </Layer>
  );
}
