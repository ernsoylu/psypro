/**
 * The central chart viewport.
 *
 * An empty, correctly-sized box until Phase 5 puts the base grid in it. It
 * exists now because the shell's job is to establish the layout the canvas will
 * measure itself against — `useChartTransform` needs a stable bounding box far
 * more than it needs something drawn inside one.
 */

import type { ReactNode } from 'react';

import { useT } from '../i18n/useT';

export function Viewport({ children }: { children?: ReactNode }) {
  const t = useT();

  return (
    <main className="viewport" aria-label={t('viewport.label')}>
      {children ?? <p className="viewport__pending">{t('viewport.pending')}</p>}
    </main>
  );
}
