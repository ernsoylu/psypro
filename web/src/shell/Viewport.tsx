/**
 * The central chart viewport.
 *
 * Structural only: it establishes the box the canvas measures itself against.
 * `useChartTransform` needs a stable bounding box more than it needs to know
 * what is drawn inside one, which is why the canvas is passed in rather than
 * mounted here.
 */

import type { ReactNode } from 'react';

import { useT } from '../i18n/useT';

export function Viewport({ children }: { children?: ReactNode }) {
  const t = useT();

  return (
    <main className="viewport" aria-label={t('viewport.label')}>
      {children}
    </main>
  );
}
