/**
 * The document's table of contents: its points, its processes, and what joins
 * what.
 *
 * Without it the chart is the only view of the document, and a chart shows
 * *positions* — it cannot show that CL is the outlet of a coil fed by MA, or
 * that a process is unresolved because its second stream was deleted. That is
 * the difference between a bag of markers and an air system, and it is what
 * "adding state points and processes is not intuitive" was pointing at.
 *
 * Each row is a selection, so this is also the only place a process can be
 * reached without hunting for its line on the chart — and the only place a
 * derived point announces which process places it before you click it.
 *
 * Rendered as one flat list in document order rather than as a tree. A tree
 * would be truer to the graph and would need a layout that reads well when the
 * graph is a diamond — outdoor and return air joining at a mixing box, then
 * splitting again — and in a 280-pixel rail the indentation would cost more
 * than it explains. The `from → to` on each process row carries the topology
 * instead.
 */

import { Icon } from './Icon';
import { useT } from '../i18n/useT';
import type { Process } from '../store/useProcessStore';
import { isDerived, type StatePoint } from '../store/usePsychStore';
import type { ResolvedPoint } from '../store/useResolvedPoints';
import type { ResolvedProcess } from '../store/useResolvedProcesses';

/** What the outline needs. */
export interface DocumentOutlineProps {
  /** Every point, in document order. */
  points: StatePoint[];
  /** Every process, in document order. */
  processes: Process[];
  /** The resolutions, by id, for the summaries and the failure marks. */
  resolvedPoints: Map<string, ResolvedPoint>;
  resolvedProcesses: Map<string, ResolvedProcess>;
  /** The name of each process kind, translated. */
  kindLabel: (process: Process) => string;
  /** Which point and which process are selected. */
  selectedPointId: string | null;
  selectedProcessId: string | null;
  /** Whether the document is in SI, for the summaries. */
  isSi: boolean;
  /** Selects a point. */
  onSelectPoint: (id: string) => void;
  /** Selects a process. */
  onSelectProcess: (id: string) => void;
}

export function DocumentOutline({
  points,
  processes,
  resolvedPoints,
  resolvedProcesses,
  kindLabel,
  selectedPointId,
  selectedProcessId,
  isSi,
  onSelectPoint,
  onSelectProcess,
}: DocumentOutlineProps) {
  const t = useT();
  const temp = t(isSi ? 'unit.celsius' : 'unit.fahrenheit');
  const labelOf = (id: string | null) =>
    (id ? points.find((p) => p.id === id)?.label : null) ?? t('outline.gone');

  if (points.length === 0) return null;

  return (
    <>
      <h2 className="panel__section">{t('outline.section')}</h2>
      <ul className="outline">
        {points.map((point) => {
          const resolved = resolvedPoints.get(point.id);
          return (
            <li key={point.id}>
              <button
                type="button"
                className={
                  point.id === selectedPointId
                    ? 'outline__row is-selected'
                    : 'outline__row'
                }
                aria-current={point.id === selectedPointId}
                onClick={() => onSelectPoint(point.id)}
              >
                <Icon name="point" size={13} />
                <span className="outline__label">{point.label}</span>
                <span className="outline__detail">
                  {resolved?.state
                    ? `${resolved.state.dbt.toFixed(1)} ${temp} · ${resolved.state.rh.toFixed(0)}%`
                    : t('outline.unresolved')}
                </span>
                {/* A derived point says so here, before it is selected: it is
                    the difference between a state someone chose and a state the
                    physics produced. */}
                {isDerived(point) ? (
                  <span className="outline__badge">{t('outline.derived')}</span>
                ) : null}
              </button>
            </li>
          );
        })}

        {processes.map((process) => {
          const resolved = resolvedProcesses.get(process.id);
          return (
            <li key={process.id}>
              <button
                type="button"
                className={
                  process.id === selectedProcessId
                    ? 'outline__row is-selected'
                    : 'outline__row'
                }
                aria-current={process.id === selectedProcessId}
                onClick={() => onSelectProcess(process.id)}
              >
                <Icon name="process" size={13} />
                <span className="outline__label">
                  {labelOf(process.fromId)} → {labelOf(process.toId ?? process.secondId)}
                </span>
                <span className="outline__detail">{kindLabel(process)}</span>
                {resolved?.error ? (
                  <span className="outline__badge outline__badge--error">
                    {t('outline.failed')}
                  </span>
                ) : resolved?.dehumidified ? (
                  // Worth a badge of its own: a process the user asked to be
                  // horizontal that is condensing water is the single most
                  // consequential thing the outline can tell them at a glance.
                  <span className="outline__badge">{t('outline.wet')}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
