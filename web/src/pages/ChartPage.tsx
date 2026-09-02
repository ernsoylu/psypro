/**
 * The chart page: the canvas and the properties panel.
 *
 * A page rather than the shell itself, since Phase 8: the shell now holds
 * several views of one document, and the chart is the first of them.
 */

import type { ReactNode } from 'react';

/** The chart page's regions. */
export interface ChartPageProps {
  /** The canvas, inside its measured viewport. */
  viewport: ReactNode;
  /** The properties panel. */
  panel: ReactNode;
  /** The layers panel, shown instead of the properties panel when open. */
  layers: ReactNode;
  /** Which of the two right-hand panels is showing. */
  showLayers: boolean;
}

export function ChartPage({ viewport, panel, layers, showLayers }: ChartPageProps) {
  return (
    <>
      {viewport}
      {/* One rail, two panels. Two rails would leave under half the width for
          the chart at 1280px, and the chart is the thing being read. */}
      {showLayers ? layers : panel}
    </>
  );
}
