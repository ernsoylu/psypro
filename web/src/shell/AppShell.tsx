/**
 * The application frame: nav across the top, toolbox and panel flanking the
 * viewport.
 *
 * Structural only — it takes the three regions as nodes and places them. The
 * shell owns no application state, which is what lets the Data Table and
 * Process Design screens reuse it later with different sides.
 */

import type { ReactNode } from 'react';

/** The three regions the shell places around the viewport. */
export interface AppShellProps {
  /** Rendered in the 48px top bar. */
  nav: ReactNode;
  /** Rendered in the 64px left rail. */
  toolbox: ReactNode;
  /** Rendered in the central area. */
  viewport: ReactNode;
  /** Rendered in the 320px right rail. */
  panel: ReactNode;
}

export function AppShell({ nav, toolbox, viewport, panel }: AppShellProps) {
  return (
    <div className="shell">
      {nav}
      <div className="shell__body">
        {toolbox}
        {viewport}
        {panel}
      </div>
    </div>
  );
}
