/**
 * The translation layer.
 *
 * Every user-facing string in the app comes from here. `src/theme.test.ts`
 * fails the build if a literal is written into a component instead, which is
 * the only way a rule like this survives contact with a growing codebase.
 *
 * The bundle is a flat `key -> string` map rather than a nested object: flat
 * keys are what translation tooling round-trips without argument, and they make
 * `TranslationKey` a plain union that the compiler can check call sites
 * against. A mistyped key is a type error, not a string that renders as itself.
 */

import en from './en.json';

/** Locales the app ships with. */
export const LOCALES = ['en'] as const;

/** A locale the app can render in. */
export type Locale = (typeof LOCALES)[number];

/**
 * Every key in the bundle.
 *
 * Derived from the English bundle, which is therefore the schema: a
 * translation that adds a key nobody asked for is a mistake, and one that omits
 * a key is caught by {@link BUNDLES} failing to typecheck.
 */
export type TranslationKey = keyof typeof en;

/** Values interpolated into a string's `{placeholder}` slots. */
export type TranslationVars = Record<string, string | number>;

const BUNDLES: Record<Locale, Record<TranslationKey, string>> = { en };

/** The locale to fall back to when a bundle is missing a key. */
export const FALLBACK_LOCALE: Locale = 'en';

/**
 * Resolves a key, substituting `{name}` placeholders from `vars`.
 *
 * An unresolved key returns the key itself rather than throwing. A missing
 * string should look wrong in the UI, not take the application down — and the
 * key is the most useful thing to show, because it says what is missing.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  vars?: TranslationVars,
): string {
  const template = BUNDLES[locale]?.[key] ?? BUNDLES[FALLBACK_LOCALE][key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** The keys the bundle defines, for tests and tooling. */
export function translationKeys(): TranslationKey[] {
  return Object.keys(en) as TranslationKey[];
}
