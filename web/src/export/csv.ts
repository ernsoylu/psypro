/**
 * CSV export of points and processes.
 *
 * Written as *resolved* values rather than inputs, which is the opposite of what
 * the project file does — and for the opposite reason. A `.psy` is reopened by
 * PsyPro and recomputed; a CSV is opened in a spreadsheet by someone who wants
 * the numbers, and handing them two inputs to re-derive twelve properties from
 * would be useless.
 */

import type { FormattedProperty } from '../chart/format';
import type { ResolvedPoint } from '../store/useResolvedPoints';

/** Quotes a field only when it needs it, so the file stays readable. */
function cell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * One row per point, one column per property.
 *
 * The unit is part of the header rather than the cell: a spreadsheet can sum a
 * column of numbers and cannot sum a column of "24.00 °C".
 */
export function pointsToCsv(
  points: ResolvedPoint[],
  format: (point: ResolvedPoint) => FormattedProperty[],
): string {
  const resolved = points.filter((p) => p.state !== null);
  if (resolved.length === 0) return '';

  const columns = format(resolved[0]!);
  const header = ['Point', ...columns.map((c) => `${c.label} (${c.unit})`)];
  const rows = resolved.map((p) => [p.point.label, ...format(p).map((c) => c.value)]);

  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
