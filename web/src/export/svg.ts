/**
 * SVG export of the chart.
 *
 * Vector rather than a canvas bitmap, because the chart's whole value is that
 * lines can be followed to a scale — and a raster at print resolution is either
 * enormous or unreadable.
 *
 * Written directly rather than lifted off Konva. Konva's own `toDataURL` gives a
 * bitmap, and its SVG story is a plugin; the chart's geometry is already
 * available as chart-space coordinates, so projecting them into an SVG viewBox
 * is less code than adapting a renderer built for a different target.
 */

import { curveStyle } from '../chart/style';
import { toScreen, type Viewport } from '../chart/geometry';
import type { GridCurve } from '../chart/useBaseGrid';
import type { ChartTokens } from '../chart/useChartTokens';
import type { CurveFamilyId } from '../psychro';
import type { FamilyStyle } from '../store/useStyleStore';
import type { ResolvedPoint } from '../store/useResolvedPoints';
import type { ResolvedProcess } from '../store/useResolvedProcesses';

/** What an export draws. */
export interface SvgExportInput {
  curves: GridCurve[];
  points: ResolvedPoint[];
  processes: ResolvedProcess[];
  viewport: Viewport;
  tokens: ChartTokens;
  /** The line-styling matrix, so an export carries the reader's restyling. */
  styles?: Record<CurveFamilyId, FamilyStyle>;
  width: number;
  height: number;
  /** Shown in the corner, so a printed chart says what it is. */
  title: string;
  /** The conditions the chart was drawn at — pressure is not optional context. */
  subtitle: string;
}

/** Escapes text for an XML text node. */
function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Rounds to a tenth of a pixel: below that is noise, and it doubles the size. */
function px(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

/** A polyline element for one curve. */
function polyline(coords: Float64Array, viewport: Viewport, style: string): string {
  const points: string[] = [];
  for (let i = 0; i < coords.length; i += 2) {
    const p = toScreen(viewport, coords[i]!, coords[i + 1]!);
    points.push(`${px(p.x)},${px(p.y)}`);
  }
  return `<polyline points="${points.join(' ')}" ${style}/>`;
}

/**
 * Renders the chart as a standalone SVG document.
 *
 * Colours are resolved rather than left as `var(--…)`: an SVG opened outside the
 * app has no stylesheet, and a chart that renders as invisible lines in Inkscape
 * is not an export.
 */
export function chartToSvg(input: SvgExportInput): string {
  const { viewport, tokens, width, height } = input;
  const parts: string[] = [];

  parts.push(
    `<rect width="${px(width)}" height="${px(height)}" fill="${tokens.background}"/>`,
  );

  for (const curve of input.curves) {
    const s = curveStyle(curve.family, curve.value, tokens, input.styles);
    const dash = s.dash ? ` stroke-dasharray="${s.dash.join(' ')}"` : '';
    parts.push(
      polyline(
        curve.coords,
        viewport,
        `fill="none" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" stroke-opacity="${s.opacity}"${dash}`,
      ),
    );
  }

  for (const process of input.processes) {
    if (!process.from || !process.to) continue;
    const a = toScreen(viewport, process.from.x, process.from.y);
    const b = toScreen(viewport, process.to.x, process.to.y);
    parts.push(
      `<line x1="${px(a.x)}" y1="${px(a.y)}" x2="${px(b.x)}" y2="${px(b.y)}" ` +
        `stroke="${tokens.process}" stroke-width="1.75" marker-end="url(#arrow)"/>`,
    );
  }

  for (const point of input.points) {
    if (!point.position) continue;
    const p = toScreen(viewport, point.position.x, point.position.y);
    parts.push(
      `<circle cx="${px(p.x)}" cy="${px(p.y)}" r="5" fill="${tokens.point}" ` +
        `stroke="${tokens.background}" stroke-width="1.5"/>`,
      `<text x="${px(p.x + 9)}" y="${px(p.y - 7)}" font-family="monospace" ` +
        `font-size="11" font-weight="bold" fill="${tokens.text}">${escapeXml(point.point.label)}</text>`,
    );
  }

  parts.push(
    `<text x="12" y="20" font-family="sans-serif" font-size="13" font-weight="600" ` +
      `fill="${tokens.text}">${escapeXml(input.title)}</text>`,
    `<text x="12" y="36" font-family="monospace" font-size="10" ` +
      `fill="${tokens.axis}">${escapeXml(input.subtitle)}</text>`,
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px(width)}" height="${px(height)}" ` +
      `viewBox="0 0 ${px(width)} ${px(height)}">`,
    '<defs>',
    `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" ` +
      `markerHeight="6" orient="auto-start-reverse">` +
      `<path d="M 0 0 L 10 5 L 0 10 z" fill="${tokens.process}"/></marker>`,
    '</defs>',
    ...parts,
    '</svg>',
    '',
  ].join('\n');
}
