/**
 * The chart page: the canvas and the properties panel.
 *
 * A page rather than the shell itself, since Phase 8: the shell now holds
 * several views of one document, and the chart is the first of them.
 */

import type { ReactNode } from 'react';

/** The chart page's two halves. */
export interface ChartPageProps {
  /** The canvas, inside its measured viewport. */
  viewport: ReactNode;
  /** The properties panel. */
  panel: ReactNode;
}

export function ChartPage({ viewport, panel }: ChartPageProps) {
  return (
    <>
      {viewport}
      {panel}
    </>
  );
}
