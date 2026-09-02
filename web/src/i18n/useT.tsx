/**
 * React binding for the translation layer.
 *
 * Kept apart from `i18n/index.ts` so the bundle and `translate` stay usable
 * from plain TypeScript — stores, workers, and tests should not have to mount a
 * component to read a string.
 */

import { createContext, use, useMemo, type ReactNode } from 'react';

import {
  FALLBACK_LOCALE,
  translate,
  type Locale,
  type TranslationKey,
  type TranslationVars,
} from './index';

/** Resolves a key in the active locale. */
export type Translator = (key: TranslationKey, vars?: TranslationVars) => string;

const LocaleContext = createContext<Locale>(FALLBACK_LOCALE);

/** Provides the active locale to everything below it. */
export function LocaleProvider({
  locale = FALLBACK_LOCALE,
  children,
}: {
  locale?: Locale;
  children: ReactNode;
}) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

/**
 * The translator for the active locale.
 *
 * Memoised on the locale, so a component that takes `t` as a dependency does
 * not re-run on every render of its parent.
 */
export function useT(): Translator {
  const locale = use(LocaleContext);
  return useMemo(
    () => (key: TranslationKey, vars?: TranslationVars) => translate(locale, key, vars),
    [locale],
  );
}

/** The active locale, for anything that needs to format numbers or dates. */
export function useLocale(): Locale {
  return use(LocaleContext);
}
