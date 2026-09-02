/**
 * The application frame: nav across the top, toolbox and panel flanking the
 * viewport.
 *
 * Structural only — it takes the three regions as nodes and places them. The
 * shell owns no application state, which is what lets the Data Table and
 * Process Design screens reuse it later with different sides.
 */

import type { ReactNode } from 'react';

/** The regions the shell places around the active page. */
export interface AppShellProps {
  /** Rendered in the 48px top bar. */
  nav: ReactNode;
  /** The page tab strip, below the nav. */
  tabs: ReactNode;
  /** Rendered in the 64px left rail. */
  toolbox: ReactNode;
  /** The active page — everything between the rails. */
  children: ReactNode;
}

export function AppShell({ nav, tabs, toolbox, children }: AppShellProps) {
  return (
    <div className="shell">
      {nav}
      {tabs}
      <div className="shell__body">
        {toolbox}
        {children}
      </div>
    </div>
  );
}
