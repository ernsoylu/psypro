/**
 * The export formats, checked for the properties a downstream tool needs.
 *
 * An export is only worth having if the thing that opens it can read it, so
 * these test structure rather than appearance: a DXF with an unbalanced SECTION
 * will not open in any CAD program, and an SVG carrying `var(--colour)` renders
 * as invisible lines outside the app.
 */

import { describe, expect, it } from 'vitest';

import { chartToDxf } from './dxf';
import { chartToSvg } from './svg';
import { pointsToCsv } from './csv';
import { CurveFamilyId, InputState } from '../psychro';
import { DEFAULT_STYLES } from '../store/useStyleStore';
import type { ChartTokens } from '../chart/useChartTokens';
import type { GridCurve } from '../chart/useBaseGrid';
import type { ResolvedPoint } from '../store/useResolvedPoints';
import type { ResolvedProcess } from '../store/useResolvedProcesses';

const TOKENS: ChartTokens = {
  family: {
    [CurveFamilyId.DryBulb]: '#c3cad4',
    [CurveFamilyId.HumidityRatio]: '#c3cad4',
    [CurveFamilyId.RelativeHumidity]: '#6ba368',
    [CurveFamilyId.WetBulb]: '#4a90c2',
    [CurveFamilyId.Enthalpy]: '#c27b4a',
    [CurveFamilyId.SpecificVolume]: '#9b7bc2',
  },
  saturation: '#2f7a4f',
  axis: '#5b6472',
  text: '#14181f',
  background: '#ffffff',
  point: '#d4441c',
  process: '#1c6fd4',
  zoneComfort: '#6ba36833',
  zoneDatacenter: '#4a90c226',
};

const CURVES: GridCurve[] = [
  {
    family: CurveFamilyId.RelativeHumidity,
    value: 1,
    coords: Float64Array.from([0, 0.004, 20, 0.015, 30, 0.027]),
  },
  {
    family: CurveFamilyId.WetBulb,
    value: 20,
    coords: Float64Array.from([40, 0, 20, 0.014]),
  },
];

const POINTS = [
  {
    point: { id: 'pt-1', label: 'OA', dryBulb: 35, mode: InputState.DbtRh, secondValue: 40 },
    state: null,
    position: { x: 35.5, y: 0.014 },
    error: null,
  },
] as unknown as ResolvedPoint[];

const PROCESSES = [
  {
    process: { id: 'pr-1' },
    from: { x: 35.5, y: 0.014 },
    to: { x: 25.2, y: 0.009 },
  },
] as unknown as ResolvedProcess[];

const VIEWPORT = { scaleX: 12, scaleY: 24000, offsetX: 40, offsetY: 800 };

describe('SVG export', () => {
  const svg = chartToSvg({
    curves: CURVES,
    points: POINTS,
    processes: PROCESSES,
    viewport: VIEWPORT,
    tokens: TOKENS,
    width: 900,
    height: 700,
    title: 'Untitled Project',
    subtitle: 'Sea level · 101.325 kPa',
  });

  it('is a standalone document', () => {
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 900 700"');
    expect(svg.trimEnd()).toMatch(/<\/svg>$/);
  });

  it('resolves every colour rather than leaving a CSS variable', () => {
    // An SVG opened in Inkscape has no stylesheet. A chart that renders as
    // invisible lines outside the app is not an export.
    expect(svg).not.toContain('var(--');
    expect(svg).toContain('#2f7a4f');
  });

  it('draws the curves, the process and the point', () => {
    expect(svg).toContain('<polyline');
    expect(svg).toContain('marker-end="url(#arrow)"');
    expect(svg).toContain('>OA<');
  });

  it('says what the chart is and what it was drawn at', () => {
    // A printed chart with no pressure on it is a chart whose numbers cannot be
    // checked, because humidity ratio depends on it.
    expect(svg).toContain('Untitled Project');
    expect(svg).toContain('101.325 kPa');
  });

  it('escapes text rather than emitting broken XML', () => {
    const hostile = chartToSvg({
      curves: [],
      points: [],
      processes: [],
      viewport: VIEWPORT,
      tokens: TOKENS,
      width: 10,
      height: 10,
      title: 'A & B <script>',
      subtitle: '',
    });
    expect(hostile).toContain('A &amp; B &lt;script&gt;');
    expect(hostile).not.toContain('<script>');
  });

  it('carries the styling matrix into the exported document', () => {
    const styled = chartToSvg({
      curves: CURVES,
      points: [],
      processes: [],
      viewport: VIEWPORT,
      tokens: TOKENS,
      width: 900,
      height: 700,
      title: 'Untitled Project',
      subtitle: '',
      styles: {
        ...DEFAULT_STYLES,
        [CurveFamilyId.WetBulb]: { color: '#123456', lineStyle: 'dotted', width: 2 },
      },
    });
    // Only the wet-bulb curve carries the override; the rest of the chart keeps
    // the theme colours it was exported with.
    const wetBulb = styled.match(/<polyline[^>]*stroke="#123456"[^>]*\/>/);
    expect(wetBulb).not.toBeNull();
    expect(wetBulb![0]).toContain('stroke-dasharray="1 3"');
    expect(wetBulb![0]).toContain('stroke-width="2"');
  });

  it('keeps saturation solid and on the RH colour, in the export too', () => {
    const styled = chartToSvg({
      curves: CURVES,
      points: [],
      processes: [],
      viewport: VIEWPORT,
      tokens: TOKENS,
      width: 900,
      height: 700,
      title: 'Untitled Project',
      subtitle: '',
      styles: {
        ...DEFAULT_STYLES,
        [CurveFamilyId.RelativeHumidity]: {
          ...DEFAULT_STYLES[CurveFamilyId.RelativeHumidity],
          color: '#aa0000',
        },
      },
    });
    // Saturation is the first curve, so the first polyline is the boundary.
    const saturation = styled.match(/<polyline[^>]*\/>/);
    expect(saturation).not.toBeNull();
    expect(saturation![0]).toContain('stroke="#aa0000"');
    expect(saturation![0]).toContain('stroke-width="2"');
    expect(saturation![0]).not.toContain('stroke-dasharray');
  });
});

describe('DXF export', () => {
  const dxf = chartToDxf({
    curves: CURVES,
    points: POINTS,
    processes: PROCESSES,
    humidityScale: 1000,
  });
  const lines = dxf.split('\n');

  it('declares the version its entities actually belong to', () => {
    // LWPOLYLINE arrives in R2000; declaring R12 while emitting one opens on a
    // lenient reader and fails on a strict one, which is the worst combination
    // because it passes wherever it is tested.
    expect(dxf).toContain('AC1015');
    expect(dxf).not.toContain('AC1009');
    expect(lines.at(-2)).toBe('EOF');
    // Every SECTION is closed. An unbalanced one will not open anywhere.
    const opens = lines.filter((l) => l === 'SECTION').length;
    const closes = lines.filter((l) => l === 'ENDSEC').length;
    expect(opens).toBe(closes);
    expect(opens).toBeGreaterThanOrEqual(3);
  });

  it('declares its layers rather than creating them implicitly', () => {
    expect(dxf).toContain('LAYER');
    expect(dxf).toContain('PSY-SATURATION');
    expect(dxf).toContain('PSY-PROCESS');
  });

  it('puts saturation on its own layer', () => {
    // A CAD user switching the relative-humidity family off must not lose the
    // boundary of the physical region with it.
    const saturationBlock = dxf.slice(dxf.indexOf('ENTITIES'));
    expect(saturationBlock).toContain('PSY-SATURATION');
    expect(saturationBlock).toContain('PSY-WETBULB');
  });

  it('exports model coordinates, not screen pixels', () => {
    // A CAD drawing has no viewport. Exporting pixels would make the drawing's
    // scale an accident of the window it came from — and the DXF signature takes
    // no viewport at all, which is what makes that impossible rather than
    // merely unlikely.
    expect(dxf).toContain('35.500000');
    // The same point in screen space would be 35.5 × 12 + 40 = 466.
    expect(dxf).not.toContain('466.0');
  });

  it('scales humidity ratio so the drawing is usable', () => {
    // The two chart axes differ by three orders of magnitude; a drawing 60 units
    // wide and 0.03 tall has an unusable zoom extent and unusable snaps.
    expect(dxf).toContain('14.000000');
  });
});

describe('CSV export', () => {
  it('puts the unit in the header so a column can be summed', () => {
    const csv = pointsToCsv(
      [{ ...POINTS[0]!, state: {} as never }],
      () => [
        { key: 'dbt', label: 'Dry-bulb temperature', value: '24.00', unit: '°C' },
        { key: 'w', label: 'Humidity ratio', value: '0.009340', unit: 'kg/kg' },
      ],
    );
    const [header, row] = csv.trim().split('\n');
    expect(header).toBe('Point,Dry-bulb temperature (°C),Humidity ratio (kg/kg)');
    // A spreadsheet can sum a column of numbers; it cannot sum "24.00 °C".
    expect(row).toBe('OA,24.00,0.009340');
  });

  it('quotes only what needs quoting', () => {
    const csv = pointsToCsv(
      [
        {
          ...POINTS[0]!,
          point: { ...POINTS[0]!.point, label: 'OA, summer' },
          state: {} as never,
        },
      ],
      () => [{ key: 'dbt', label: 'Dry-bulb', value: '24.00', unit: '°C' }],
    );
    expect(csv).toContain('"OA, summer",24.00');
  });

  it('returns nothing when there is nothing to export', () => {
    expect(pointsToCsv([], () => [])).toBe('');
  });
});
