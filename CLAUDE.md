# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project identity

This project is **PsyPro**, an open-source psychrometric chart application. HDPsyChart is a
separate proprietary product used only as an early functional reference — never name PsyPro
after it, describe PsyPro as a clone or successor of it, or copy its branding or assets.

## Repository status

Phase 0 of `DEVELOPMENT_PLAN.md` is complete: the Cargo workspace, the React/Vite app, and
CI exist, but no psychrometric logic is implemented yet. `REQUIREMENTS.md` is the product
spec and the source of truth; `DEVELOPMENT_PLAN.md` holds the phased build order and the
open decisions. Update the Commands section below as each phase lands.

`RustProp` is a first-party product of the maintainer. Phase 1 wraps it behind the
`psychro-core` API so the dependency stays swappable; how it is consumed by the build
(crates.io / git / vendored) is still open and must be settled before Phase 1.

## Branch policy

`main` is protected: direct pushes are rejected. All work goes through a feature branch and
a pull request. Never push to `main`, and never force-push a shared branch.

```bash
git checkout -b feat/<phase>-<short-slug>
# ... work, commit ...
git push -u origin HEAD
gh pr create --fill
```

## Commands

Verified against the current scaffold. Frontend commands run from `web/`.

| Purpose | Command |
|---|---|
| Build the WASM engine | `npm run wasm` |
| Frontend dev server | `npm run dev` (rebuilds WASM first) |
| Frontend typecheck / lint / test | `npm run typecheck` / `npm run lint` / `npm run test` |
| Single frontend test | `npx vitest run src/App.test.tsx -t "renders the application shell"` |
| Rust tests | `cargo test --workspace` |
| Single Rust test | `cargo test -p psychro-core <name> -- --exact --nocapture` |
| Rust format / lint | `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings` |

`web/src/wasm/` is generated and gitignored, so it must be built before the frontend can
typecheck against it — a missing or stale `out-dir` is the usual cause of "module has no
exported member" errors on generated types.

Clippy runs with `-D warnings` and the workspace sets `missing_docs = "warn"`, so an
undocumented public Rust item fails CI.

TypeScript is pinned to 6.x: `typescript-eslint` declares a peer range of `<6.1.0` and does
not support TypeScript 7 yet.

## Architecture

Three layers with a hard separation of concerns. The boundaries are the load-bearing part of
the design (they are what makes the project forkable and unit-testable), so keep them intact.

### 1. Rust → WASM calculation engine

All thermodynamics lives in Rust, wrapping the `RustProp` library, compiled via `wasm-bindgen`.

- **TypeScript never reimplements psychrometric math.** If a value can be derived
  thermodynamically, it comes from a WASM call. No parallel JS formulas, not even for
  "quick" previews — divergence between the two is the failure mode this rule exists to prevent.
- **Types flow one way.** `wasm-bindgen` emits `.d.ts`; the frontend imports those generated
  interfaces. Do not hand-write a TS mirror of a Rust struct.
- **The engine is stateless.** Every entry point takes an explicit input struct (including
  `altitude` and `is_si`) and returns a result. Unit system and elevation are inputs, never
  ambient state inside the engine.
- Public functions carry Rustdoc — this is a contributor-facing API surface, not internal code.

Core contracts (see `REQUIREMENTS.md` §3 and the blueprint):
`calculate_state`, `mix_air`, `get_coordinate_mapping`, `bin_weather_data`.

### 2. Coordinate transformation — two distinct stages

Do not collapse these into one function; they change for different reasons.

- **Physical → chart space** happens in WASM (`get_coordinate_mapping`). It encodes the skewed
  axes and differs between the ASHRAE (T_db vs. W) and Mollier i-x (enthalpy vs. W) layouts.
- **Chart space → screen pixels** happens in the React hook `useChartTransform`, which owns
  zoom, pan, and the canvas bounding box.

Drag interaction runs the inverse path: Konva screen coords → chart space → WASM →
`StatePointOutput` → store. This round-trip is on the 60 FPS path, so it must stay
allocation-light and free of React re-render churn per pointer move.

### 3. State (Zustand) and rendering (React-Konva)

Stores are plain TypeScript, decoupled from React so contributors can unit-test state logic
without mounting components. Three stores, split by lifetime rather than by screen:

- `useProjectStore` — units, altitude, chart layout. Changing any of these invalidates every
  derived value, so treat it as a global recompute trigger.
- `usePsychStore` — points and processes (the document being edited).
- `useStyleStore` — the line-styling matrix and theme variables.

Rendering is a strict Z-index pipeline (`REQUIREMENTS.md` §7), Layer 0 → 4, each layer an
independent React component so a new visual layer can be added without touching the others.
Layer 0 (base grid) is cached — regenerate it only when units, altitude, or layout change,
never per frame.

### Client-side only

There is no backend. Weather data is bring-your-own: `.epw` / CSV files are parsed in a **Web
Worker** (never on the main thread — 8760-row files freeze the UI) and handed to WASM for
binning. Project files use the File System Access API. Any change that introduces a required
network call to a proprietary service breaks the self-hosting requirement in §1.

### Theming

Colors, line styles, and widths resolve through CSS variables so a fork can rebrand by editing
`theme.css` alone. Do not hard-code a color in a component or in a Konva prop; read the variable.

## Open-source constraints

- Dependencies (npm and crates alike) must be permissively licensed — MIT/Apache-2.0 or
  equivalent. Check before adding one; a copyleft transitive dep is a blocker, not a detail.
- UI strings go through the JSON i18n layer, not inline literals.
