/**
 * The page tabs.
 *
 * Tabs rather than routes: PsyPro is one document seen five ways, not five
 * documents. Switching to the data table must not lose the chart's pan or the
 * process you had selected, and a router that unmounted the canvas would throw
 * away the cached Layer 0 bitmap on every switch.
 */

import { useT } from '../i18n/useT';
import type { TranslationKey } from '../i18n';

/** The views the document can be seen in. */
export type PageId = 'chart' | 'table' | 'design' | 'weather' | 'report';

/** Which pages exist, and what they are called. */
export const PAGES = [
  ['chart', 'page.chart'],
  ['table', 'page.table'],
  ['design', 'page.processDesign'],
  ['weather', 'page.weather'],
  ['report', 'page.report'],
] as const satisfies readonly (readonly [PageId, TranslationKey])[];

/** What the tab strip needs. */
export interface PageTabsProps {
  /** The page being shown. */
  active: PageId;
  /** Switches page. */
  onChange: (page: PageId) => void;
  /** Pages that are not built yet, rendered disabled rather than hidden. */
  unavailable?: readonly PageId[];
}

export function PageTabs({ active, onChange, unavailable = [] }: PageTabsProps) {
  const t = useT();

  return (
    <div className="tabs" role="tablist" aria-label={t('page.label')}>
      {PAGES.map(([id, key]) => {
        const disabled = unavailable.includes(id);
        return (
          <button
            key={id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={active === id}
            // A page that does not exist yet is shown disabled rather than
            // hidden, for the same reason an inactive schematic block is: it
            // says "this design does not use it", not "the tool cannot".
            disabled={disabled}
            onClick={() => onChange(id)}
          >
            {t(key)}
          </button>
        );
      })}
    </div>
  );
}
