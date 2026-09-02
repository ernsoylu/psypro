/**
 * The chart page: the canvas and the properties panel.
 *
 * A page rather than the shell itself, since Phase 8: the shell now holds
 * several views of one document, and the chart is the first of them.
 */

import type { ReactNode } from 'react';

import type { PanelId } from '../shell/Toolbox';

/** The chart page's regions. */
export interface ChartPageProps {
  /** The canvas, inside its measured viewport. */
  viewport: ReactNode;
  /** The properties panel — the rail's default occupant. */
  panel: ReactNode;
  /** The layers panel. */
  layers: ReactNode;
  /** Teaching mode: the worked examples and the working. */
  teaching: ReactNode;
  /** Which of the three right-hand panels is showing. */
  activePanel: PanelId;
}

export function ChartPage({
  viewport,
  panel,
  layers,
  teaching,
  activePanel,
}: ChartPageProps) {
  return (
    <>
      {viewport}
      {/* One rail, three panels. Two rails would leave under half the width for
          the chart at 1280px, and the chart is the thing being read. */}
      {activePanel === 'layers' ? layers : activePanel === 'teaching' ? teaching : panel}
    </>
  );
}
