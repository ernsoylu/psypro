/**
 * The Phase 4 exit criterion, as a gate rather than a promise.
 *
 * "No hard-coded colour or user-facing string anywhere in `web/src`" is the
 * kind of rule that holds for exactly as long as someone is watching. These
 * tests watch. They read the source files rather than the rendered output,
 * because the failure they exist to catch is a literal typed into a component —
 * which renders perfectly and only shows up when someone forks the theme or
 * translates the app.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import en from './i18n/en.json';

/**
 * The source root, found rather than assumed.
 *
 * `import.meta.url` is not a file URL under the jsdom environment, and the
 * working directory depends on whether the runner was started from `web/` or
 * from the repository root. Looking for the theme file settles both.
 */
const located = ['src', join('web', 'src')]
  .map((candidate) => join(process.cwd(), candidate))
  .find((candidate) => existsSync(join(candidate, 'theme.css')));

if (located === undefined) {
  throw new Error(`could not locate web/src from ${process.cwd()}`);
}

const SRC: string = located;

/**
 * What the scan skips, and why.
 *
 * `wasm/` is generated, `theme.css` is where the colours are *supposed* to
 * live, and test files are not shipped UI — this file itself names a
 * `var(--missing)` in a comment, and a scan that reads its own source would
 * report it.
 */
const EXEMPT_DIRS = new Set(['wasm']);
const THEME_FILES = new Set(['theme.css']);

/** Every source file under `web/src` a human wrote. */
function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!EXEMPT_DIRS.has(entry)) sourceFiles(path, out);
    } else if (/\.(ts|tsx|css)$/.test(entry) && !/\.test\.tsx?$|^vitest\./.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/** Every first capture group a pattern finds, with the misses dropped. */
function captures(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
}

const FILES = sourceFiles().map((path) => ({
  path,
  name: relative(SRC, path),
  text: readFileSync(path, 'utf8'),
}));

describe('theming', () => {
  it('has no colour literal outside theme.css', () => {
    // Hex colours, plus the CSS colour functions. A literal here is a colour a
    // fork cannot rebrand by editing theme.css, which is the whole contract.
    const colour = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/g;
    const offenders = FILES.filter(
      (f) => !THEME_FILES.has(f.name) && colour.test(f.text) && (colour.lastIndex = 0) === 0,
    ).map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it('declares every variable the components reference', () => {
    const declared = new Set(
      FILES.filter((f) => THEME_FILES.has(f.name)).flatMap((f) =>
        captures(f.text, /^\s*(--[\w-]+):/gm),
      ),
    );
    const used = new Set(FILES.flatMap((f) => captures(f.text, /var\((--[\w-]+)/g)));
    // A `var(--missing)` renders as nothing and is invisible until someone
    // notices a control has lost its background.
    expect([...used].filter((v) => !declared.has(v))).toEqual([]);
  });

  it('defines every palette colour in both themes', () => {
    const theme = FILES.find((f) => THEME_FILES.has(f.name))?.text ?? '';
    const marker = ":root[data-theme='dark']";
    const light = theme.slice(0, theme.indexOf(marker));
    const dark = theme.slice(theme.indexOf(marker));
    const colours = (block: string) =>
      new Set(captures(block, /^\s*(--color-[\w-]+|--chart-[\w-]+):/gm));
    // Every colour is declared in `:root`, so a fork that only edits the dark
    // block still gets a complete light palette — and vice versa.
    expect([...colours(dark)].filter((c) => !colours(light).has(c))).toEqual([]);
  });
});

describe('internationalisation', () => {
  const keys = new Set(Object.keys(en));

  it('resolves every key the source asks for', () => {
    const asked = FILES.flatMap((f) => captures(f.text, /\bt\(\s*'([^']+)'/g));
    expect(asked.filter((k) => !keys.has(k))).toEqual([]);
    expect(asked.length).toBeGreaterThan(0);
  });

  it('carries no string nothing renders', () => {
    const text = FILES.map((f) => f.text).join('\n');
    // Keys reached through a table (`{ key: 'nav.save' }`) count as referenced,
    // so this looks for the quoted key anywhere rather than only inside `t(`.
    expect([...keys].filter((k) => !text.includes(`'${k}'`))).toEqual([]);
  });

  it('has no user-facing literal in a component', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      if (!f.name.endsWith('.tsx')) continue;
      // Text sitting directly between two tags, and the props a screen reader
      // reads out. Both are strings a translator would need and never sees.
      for (const literal of captures(f.text, />\s*([A-Za-z][^<>{}\n]{2,})\s*</g)) {
        offenders.push(`${f.name}: >${literal.trim()}<`);
      }
      for (const literal of captures(
        f.text,
        /\b(?:aria-label|title|placeholder|alt)=["']([^"']+)["']/g,
      )) {
        offenders.push(`${f.name}: attribute "${literal}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
