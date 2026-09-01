/**
 * Theme selection, persisted and system-aware.
 *
 * The attribute goes on `<html>` rather than a React-owned node so that
 * `theme.css` can key off `:root[data-theme='dark']` and every descendant —
 * including anything portalled outside the React tree — inherits the palette.
 * That is also why the theme is not React state passed down as props: colours
 * resolve through CSS variables, so a component never needs to know which theme
 * is active, and Konva props read the same variables in Phase 5.
 */

import { useCallback, useEffect, useState } from 'react';

/** The themes `theme.css` defines. */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'psypro.theme';

/** Whether the OS asks for a dark interface. */
function systemTheme(): Theme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * The theme to start in: a previous explicit choice, else the system setting.
 *
 * Storage access is wrapped because a private window, or a browser configured
 * to block site data, throws on read rather than returning null.
 */
function initialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // No persisted preference available; fall through to the system setting.
  }
  return systemTheme();
}

/**
 * The active theme and a toggle.
 *
 * Once the user chooses, that choice wins over the system setting for good —
 * following the OS afterwards would undo a deliberate decision every time the
 * machine switched at dusk.
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Preference cannot be persisted; the session still honours it.
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
