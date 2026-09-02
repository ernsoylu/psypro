/**
 * Teaching mode, in a panel of its own.
 *
 * The worked examples and the working used to hang off the bottom of the
 * properties panel, below the derived table and the processes. That put a
 * textbook underneath an instrument: the inspector is where a reader edits the
 * point in front of them, and it should end where that point's numbers end.
 *
 * So teaching gets the same treatment layers already had — a third panel in the
 * one right-hand rail, reached from the toolbox. §11's content is unchanged and
 * still follows the selection: the examples load a document, the working
 * derives the selected point. Only its address changed.
 */

import { ExamplePicker } from './ExamplePicker';
import { WorkingPanel } from './WorkingPanel';
import { useT } from '../i18n/useT';
import type { WorkingStep } from '../psychro';

/** What the teaching panel needs. */
export interface TeachingPanelProps {
  /** Loads a worked example by id. */
  onLoadExample: (id: string) => void;
  /** The example currently loaded, if any. */
  exampleId: string | null;
  /** Whether a point is selected, since the working derives one. */
  hasSelection: boolean;
  /** The derivation steps for the selected point, as the engine produced them. */
  steps: WorkingStep[];
  /** The real-gas correction at that state, if it could be measured. */
  correction: { wReal: number; wIdeal: number; percent: number } | null;
}

export function TeachingPanel({
  onLoadExample,
  exampleId,
  hasSelection,
  steps,
  correction,
}: TeachingPanelProps) {
  const t = useT();

  return (
    <aside className="panel" aria-label={t('teaching.label')}>
      <div className="panel__header">
        <span className="panel__title">{t('teaching.label')}</span>
      </div>

      <ExamplePicker onLoad={onLoadExample} activeId={exampleId} />

      {hasSelection ? (
        <WorkingPanel steps={steps} correction={correction} />
      ) : (
        <>
          <h2 className="panel__section">{t('working.section')}</h2>
          <p className="panel__empty">{t('teaching.noSelection')}</p>
        </>
      )}
    </aside>
  );
}
