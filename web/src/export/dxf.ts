/**
 * DXF export of the chart.
 *
 * DXF R2000 (AC1015) ASCII, and the version number is not incidental.
 *
 * The first draft declared R12, because R12 is the simplest DXF there is. But
 * the curves are written as `LWPOLYLINE`, and **`LWPOLYLINE` does not exist in
 * R12** — it arrives in R2000. Lenient readers accept the mismatch and strict
 * ones do not, which is the worst combination: it would open on the machine it
 * was tested on and fail on a reader that took the header at its word.
 *
 * R2000 is still read by everything, so declaring what is actually in the file
 * costs nothing. The alternative — emitting R12's `POLYLINE`/`VERTEX`/`SEQEND`
 * triple — is three times the bytes for a compatibility nobody needs in 2026.
 *
 * The output is in **chart-space coordinates, not pixels**. A CAD drawing has no
 * viewport: it is a model, and a psychrometric chart's model coordinates are its
 * own axes. Exporting screen pixels would make the drawing's scale an accident
 * of the window it was exported from.
 */

import type { GridCurve } from '../chart/useBaseGrid';
import type { ResolvedPoint } from '../store/useResolvedPoints';
import type { ResolvedProcess } from '../store/useResolvedProcesses';
import { ChartLayout, CurveFamilyId } from '../psychro';

/** What a DXF export draws. */
export interface DxfExportInput {
  curves: GridCurve[];
  points: ResolvedPoint[];
  processes: ResolvedProcess[];
  /**
   * How far to scale humidity ratio relative to the reduced coordinate.
   *
   * The two chart axes differ by three orders of magnitude, and a CAD drawing
   * where one axis spans 60 units and the other 0.03 is unusable — every zoom
   * extent is wrong and every snap lands in the wrong place. This puts them on
   * comparable footing while keeping the drawing a faithful model.
   */
  humidityScale: number;
  /**
   * Which construction the coordinates are in.
   *
   * It decides *which axis* `humidityScale` applies to: ASHRAE puts humidity
   * ratio on `y` and Mollier i-x exchanges the two, so scaling `y`
   * unconditionally stretched the enthalpy axis by a thousand on a Mollier
   * export and left humidity ratio spanning 0.03 units.
   */
  layout: ChartLayout;
}

/** How far a point's label sits from its marker, in drawing units. */
const LABEL_OFFSET = 0.4;

/** The per-axis scale factors for a layout. */
function axisScale(layout: ChartLayout, humidityScale: number): [number, number] {
  return layout === ChartLayout.MollierIx ? [humidityScale, 1] : [1, humidityScale];
}

/** One DXF group code and its value. */
function pair(code: number, value: string | number): string {
  return `${code}\n${value}`;
}

/** A layer name per curve family, so a CAD user can switch families off. */
const LAYER: Record<CurveFamilyId, string> = {
  [CurveFamilyId.DryBulb]: 'PSY-DRYBULB',
  [CurveFamilyId.HumidityRatio]: 'PSY-HUMRATIO',
  [CurveFamilyId.RelativeHumidity]: 'PSY-RH',
  [CurveFamilyId.WetBulb]: 'PSY-WETBULB',
  [CurveFamilyId.Enthalpy]: 'PSY-ENTHALPY',
  [CurveFamilyId.SpecificVolume]: 'PSY-VOLUME',
};

/** AutoCAD colour indices, chosen to stay legible on a white sheet. */
const COLOUR: Record<string, number> = {
  'PSY-DRYBULB': 8,
  'PSY-HUMRATIO': 8,
  'PSY-RH': 3,
  'PSY-WETBULB': 5,
  'PSY-ENTHALPY': 30,
  'PSY-VOLUME': 6,
  'PSY-SATURATION': 3,
  'PSY-POINTS': 1,
  'PSY-PROCESS': 5,
};

/** The layer table, so layers exist rather than being created implicitly. */
function layerTable(): string[] {
  const layers = Object.keys(COLOUR);
  return [
    pair(0, 'SECTION'),
    pair(2, 'TABLES'),
    pair(0, 'TABLE'),
    pair(2, 'LAYER'),
    pair(70, layers.length),
    ...layers.flatMap((name) => [
      pair(0, 'LAYER'),
      pair(2, name),
      pair(70, 0),
      pair(62, COLOUR[name] ?? 7),
      pair(6, 'CONTINUOUS'),
    ]),
    pair(0, 'ENDTAB'),
    pair(0, 'ENDSEC'),
  ];
}

/** A LWPOLYLINE from a flat chart-space run. */
function polyline(
  coords: Float64Array,
  layer: string,
  sx: number,
  sy: number,
): string[] {
  const vertices = coords.length / 2;
  if (vertices < 2) return [];
  const out = [
    pair(0, 'LWPOLYLINE'),
    pair(8, layer),
    pair(100, 'AcDbEntity'),
    pair(100, 'AcDbPolyline'),
    pair(90, vertices),
    pair(70, 0),
  ];
  for (let i = 0; i < coords.length; i += 2) {
    out.push(
      pair(10, (coords[i]! * sx).toFixed(6)),
      pair(20, (coords[i + 1]! * sy).toFixed(6)),
    );
  }
  return out;
}

/** Renders the chart as a DXF R2000 ASCII drawing. */
export function chartToDxf(input: DxfExportInput): string {
  const [sx, sy] = axisScale(input.layout, input.humidityScale);
  const body: string[] = [
    pair(0, 'SECTION'),
    pair(2, 'HEADER'),
    pair(9, '$ACADVER'),
    pair(1, 'AC1015'),
    pair(0, 'ENDSEC'),
    ...layerTable(),
    pair(0, 'SECTION'),
    pair(2, 'ENTITIES'),
  ];

  for (const curve of input.curves) {
    // Saturation gets its own layer: it is the boundary of the physical region,
    // and a CAD user switching the RH family off must not lose it.
    const saturation =
      curve.family === CurveFamilyId.RelativeHumidity && Math.abs(curve.value - 1) < 1e-9;
    body.push(
      ...polyline(
        curve.coords,
        saturation ? 'PSY-SATURATION' : LAYER[curve.family],
        sx,
        sy,
      ),
    );
  }

  for (const process of input.processes) {
    if (!process.from || !process.to) continue;
    body.push(
      pair(0, 'LINE'),
      pair(8, 'PSY-PROCESS'),
      pair(10, (process.from.x * sx).toFixed(6)),
      pair(20, (process.from.y * sy).toFixed(6)),
      pair(11, (process.to.x * sx).toFixed(6)),
      pair(21, (process.to.y * sy).toFixed(6)),
    );
  }

  for (const point of input.points) {
    if (!point.position) continue;
    body.push(
      pair(0, 'POINT'),
      pair(8, 'PSY-POINTS'),
      pair(10, (point.position.x * sx).toFixed(6)),
      pair(20, (point.position.y * sy).toFixed(6)),
      pair(0, 'TEXT'),
      pair(8, 'PSY-POINTS'),
      // The nudge is in drawing units, after scaling: both axes span tens of
      // units once `humidityScale` has done its work, so 0.4 clears the marker
      // on either of them.
      pair(10, (point.position.x * sx + LABEL_OFFSET).toFixed(6)),
      pair(20, (point.position.y * sy + LABEL_OFFSET).toFixed(6)),
      pair(40, '0.8'),
      pair(1, point.point.label),
    );
  }

  body.push(pair(0, 'ENDSEC'), pair(0, 'EOF'), '');
  return body.join('\n');
}
