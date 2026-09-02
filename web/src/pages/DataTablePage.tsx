/**
 * The data table: every state point, every property, one row each.
 *
 * The same `formatProperties` table the panel and the HUD use, transposed. That
 * is the point of there being one formatting table: a value read here and the
 * same value read in the panel are the same string, not two roundings of one
 * number that happen to look alike.
 */

import { formatProperties } from '../chart/format';
import { useT } from '../i18n/useT';
import type { ResolvedPoint } from '../store/useResolvedPoints';

/** What the table needs. */
export interface DataTablePageProps {
  /** Every point in the document, resolved. */
  points: ResolvedPoint[];
  /** Whether the document is in SI. */
  isSi: boolean;
}

export function DataTablePage({ points, isSi }: DataTablePageProps) {
  const t = useT();
  const resolved = points.filter((p) => p.state !== null);

  if (resolved.length === 0) {
    return (
      <main className="page" aria-label={t('table.label')}>
        <p className="page__empty">{t('table.empty')}</p>
      </main>
    );
  }

  // The property list of the first point defines the columns. Every point has
  // the same twelve, so this is a shape rather than a guess — except the dew
  // point, which is a frost point below freezing and says so in its own label.
  const columns = formatProperties(resolved[0]!.state!, isSi, t);

  return (
    <main className="page page--table" aria-label={t('table.label')}>
      <table className="datatable">
        <thead>
          <tr>
            <th scope="col">{t('table.point')}</th>
            {columns.map((c) => (
              <th scope="col" key={c.key}>
                {c.label}
                <span className="datatable__unit">{c.unit}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resolved.map((p) => (
            <tr key={p.point.id}>
              <th scope="row">{p.point.label}</th>
              {formatProperties(p.state!, isSi, t).map((cell) => (
                <td key={cell.key}>{cell.value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
