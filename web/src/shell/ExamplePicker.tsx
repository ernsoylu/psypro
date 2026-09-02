/**
 * The worked-example loader.
 *
 * §11 asks for examples *"traceable to their textbook source"*, and the source
 * is shown rather than filed away: an example a reader cannot look up is an
 * assertion, and the whole point of a worked example is that it can be checked.
 *
 * Each one carries what it is meant to teach, which is not the same as what it
 * computes. The Denver example computes a humidity ratio; what it teaches is
 * that elevation is an input to every calculation rather than a refinement.
 */

import { useT } from '../i18n/useT';
import { EXAMPLES } from '../data';

/** What the picker needs. */
export interface ExamplePickerProps {
  /** Loads an example by id. */
  onLoad: (id: string) => void;
  /** The example currently loaded, if any. */
  activeId: string | null;
}

export function ExamplePicker({ onLoad, activeId }: ExamplePickerProps) {
  const t = useT();
  const active = EXAMPLES.find((e) => e.id === activeId);

  return (
    <>
      <h2 className="panel__section">{t('examples.section')}</h2>
      <div className="panel__fields">
        <label className="field">
          <span className="field__label">{t('examples.pick')}</span>
          <select
            className="field__input"
            value={activeId ?? ''}
            onChange={(e) => e.target.value && onLoad(e.target.value)}
          >
            <option value="">{t('examples.choose')}</option>
            {EXAMPLES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
        {active ? (
          <>
            <p className="panel__note">{active.teaches}</p>
            <p className="working__reference">{active.source}</p>
          </>
        ) : null}
      </div>
    </>
  );
}
