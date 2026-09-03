# Dependency license audit

**Date:** 2026-09-03 (re-run on adding `@xyflow/react`) · **Audited:** `web/package-lock.json` (npm) and the Cargo workspace
lockfile (`crates/` + `vendor/frees-wasm` submodule).

## The rule

PsyPro is MIT-licensed and self-hostable by anyone, so every dependency must be
permissively licensed — MIT, Apache-2.0, or an equivalent (ISC, BSD, BlueOak, MIT-0,
CC0, Unlicense). A copyleft dependency reaching the shipped bundle (GPL, LGPL, AGPL,
EPL, or MPL-linked code) is a blocker, not a detail. Dev-only tooling is held to the
same standard, with file-scoped copyleft judged on whether it can reach the artifact
users receive.

## npm (the web app)

Method: every installed package's `package.json` `license` field, deduplicated by
`name@version`. Reproduce with:

```sh
cd web && npm ls --omit=dev --all --parseable   # runtime tree
```

### Full tree (248 unique packages, dev included)

| Count | License |
|---:|---|
| 198 | MIT |
| 18 | Apache-2.0 |
| 12 | ISC |
| 8 | BSD-2-Clause |
| 3 | BSD-3-Clause |
| 3 | MPL-2.0 |
| 2 | BlueOak-1.0.0 |
| 2 | MIT-0 |
| 1 | CC-BY-4.0 |
| 1 | CC0-1.0 |

### Runtime tree (what ships in the bundle)

**All MIT, ISC or BSD-3-Clause.** The runtime dependencies are `konva`, `react`,
`react-dom`, `react-konva`, `zustand` and `@xyflow/react`, plus their transitive
closure. Nothing copyleft, nothing ambiguous, reaches the served JavaScript or the
WASM it calls.

**`@xyflow/react` 12.11.6 — MIT** (added for the circuit designer). Its own tree is
`classcat` (MIT), `@xyflow/system` (MIT), the `d3-drag` / `d3-zoom` / `d3-selection` /
`d3-interpolate` / `d3-color` / `d3-transition` / `d3-dispatch` / `d3-timer` family
(ISC), `d3-ease` (BSD-3-Clause), and the `@types/d3-*` declarations (MIT, dev-only at
runtime). ISC and BSD-3-Clause are permissive and the rule above admits them; both
require only that the notice travel with the source, which npm's own tree satisfies.
It reuses the `zustand` already in the tree rather than adding a second state library.

Worth recording alongside the licence: it costs **191 kB raw / 61 kB gzipped**, the
largest single dependency after the engine itself. That was a deliberate trade against
hand-rolling a node canvas — see `docs/schematic-designer-plan.md` §5.

### The three non-permissive-by-name findings, adjudicated

1. **`lightningcss` and its platform binaries — MPL-2.0.** Vite's build-time CSS
   transformer. Dev-only: it runs during `vite build` and never ships — its output is
   minified CSS, which is not a derivative work of the transformer under MPL's
   file-scoped copyleft. The three installed packages are `lightningcss` itself plus
   the host platform's native binaries (the lockfile's other platform binaries are the
   same license). **Accepted**, with this rationale on record.

2. **`caniuse-lite` — CC-BY-4.0.** Browser-compatibility *data* consumed at build time
   by browserslist/Vite targets. Data, not code; the attribution requirement is met by
   this audit and the package's own license file. **Accepted.**

3. **`mdn-data` — CC0-1.0.** Public-domain dedication, used by dev-time CSS tooling.
   **Accepted** (CC0 is more permissive than MIT).

ISC, BSD-2/3-Clause, BlueOak-1.0.0, and MIT-0 packages (eslint's ecosystem, `semver`,
`which`, `lru-cache`, `minimatch`, `source-map-js`, `tough-cookie`, …) are all
permissive and compatible; they appear in the table above for completeness, not as
findings.

## Cargo (the calculation engine)

Method: `cargo metadata` over the workspace lockfile, 69 unique crates. **All
permissive** — no GPL, LGPL, AGPL, EPL, or MPL anywhere in the tree.

| Family | Crates |
|---|---|
| MIT | `frees-core`, `rustprop` and its feature crates (first-party, vendored/submoduled), `psychro-core`, `psychro-wasm`, `libm`, and most of the tree |
| MIT **OR** Apache-2.0 | `wasm-bindgen` and the broader wasm-bindgen family, `cfg-if`, `once_cell`, … |
| (MIT OR Apache-2.0) **AND** Unicode-3.0 | `unicode-ident` — both components permissive |
| MIT OR Zlib OR Apache-2.0 | `miniz_oxide` (via `flate2`) |
| 0BSD OR MIT OR Apache-2.0 | `adler2` |

Every disjunctive expression in the tree offers a MIT path.

## Verdict

**Clean.** The shipped artifact (static bundle + WASM + nginx image) contains only
MIT, ISC and BSD-3-Clause code, all permissive. The sole file-scoped copyleft (`lightningcss`, MPL-2.0) is build tooling
whose output is not a derivative work, and it is documented above. Re-run this audit
whenever `package-lock.json` or `Cargo.lock` gains a dependency.
