# PsyPro — Phased Development Plan

Each phase is **atomic**: it lands as one pull request, leaves `main` in a working and
demonstrable state, and has an exit criterion that can be checked without reading the diff.
Phases are ordered so that nothing is built on top of an unverified layer. A phase is not
"done" because the code exists — it is done when its exit criterion passes in CI.

Dependencies are noted where a phase can be parallelised; everything else is strictly serial.

---

## Phase 0 — Repository foundation
**Goal:** A contributor can clone the repo and get a green build before any feature exists.

- Monorepo layout: `crates/psychro-core`, `crates/psychro-wasm`, `web/`.
- Cargo workspace + Vite/React/TypeScript app in `web/` with `strict: true`.
- `LICENSE` (decide MIT vs. Apache-2.0 — this is a blocking decision, see Open Questions),
  `CONTRIBUTING.md` covering the Rust + wasm-pack + Node setup, `CODE_OF_CONDUCT.md`.
- GitHub Actions: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`,
  `wasm-pack build`, `tsc --noEmit`, `eslint`, `vitest`.
- Branch protection on `main` (already applied).

**Exit:** CI green on a PR that changes nothing but the scaffold. `npm run dev` serves a blank shell.

---

## Phase 1 — Rust thermodynamic core
**Goal:** Correct psychrometrics, headless, with no WASM or UI involved.

- `RustProp` wrapped behind our own `psychro-core` API so the dependency stays swappable.
- `InputState` enum (DbtWbt, DbtRh, DbtEnthalpy, …), `StatePointInput`, `StatePointOutput`.
- IP/SI handling and altitude → barometric pressure; high-pressure support to 100 PSI.
- Sub-zero saturation: Goff-Gratch / ASHRAE ice-vs-water branch below 0 °C.
- Fog region: saturation vs. mixture enthalpy.
- Rustdoc on every public item.

**Exit:** `cargo test` passes a table of ASHRAE Handbook reference values (sea level, altitude,
sub-zero, and high-pressure cases) within a documented tolerance. No UI exists yet.

---

## Phase 2 — WASM bridge and typed handshake
**Goal:** Prove the Rust↔TypeScript contract before anything depends on it.

- `wasm-bindgen` wrappers, `Result<_, JsValue>` error surface, generated `.d.ts` consumed by `web/`.
- Vite plugin/config for loading the WASM module.
- A throwaway debug panel that calls `calculate_state` and prints the result.

**Exit:** Typing a dry-bulb and RH into the debug panel prints a full `StatePointOutput`,
with `tsc --noEmit` passing against the *generated* types only (no hand-written mirrors).

---

## Phase 3 — Coordinate transformation engine
**Goal:** The geometry that every visual layer will depend on.

- `get_coordinate_mapping` in Rust: physical properties → chart space, for both the
  ASHRAE (T_db vs. W) and Mollier i-x layouts, with skewed axes.
- The inverse mapping (chart space → properties) for click/drag.
- Constant-property curve generation (RH, wet-bulb, enthalpy, specific volume families)
  emitted as path data.

**Exit:** Rust round-trip property test — `map(unmap(p)) ≈ p` across the chart domain for both
layouts — plus curve generation benchmarked so a full grid regenerates in well under one frame.

---

## Phase 4 — Application shell and theme system
**Goal:** The static frame, themable from day one. *Parallelisable with Phase 3.*

- Top nav (48px), left toolbox (64px), right properties panel (320px), central viewport.
- `theme.css` with the full CSS-variable palette; light/dark toggle.
- Typography: monospace for numerics, sans-serif for UI.
- i18n scaffolding with all shell strings already externalised to JSON.

**Exit:** No hard-coded color or user-facing string anywhere in `web/src`; swapping `theme.css`
visibly retextures the whole shell.

---

## Phase 5 — Canvas Layer 0 (base grid)
**Goal:** A real, readable psychrometric chart on screen.

- `useChartTransform` hook: chart space → screen, owning zoom, pan, and resize.
- `PsychGrid` component consuming Phase 3 path data, styled via CSS variables.
- Grid caching keyed on units + altitude + layout; infinite pan and zoom-window controls.

**Exit:** Both chart layouts render correctly, pan/zoom stay smooth, and the grid is *not*
regenerated on pan/zoom (assert via a render counter in a test).

---

## Phase 6 — State store and interactive points (Layer 3 + Layer 4)
**Goal:** The core editing loop.

- `useProjectStore`, `usePsychStore`, `useStyleStore` — plain TS, unit-tested without React.
- `PointLayer` with Konva `onDragMove` → screen → chart space → WASM → store.
- Properties panel with two-way binding: click-to-place *and* manual numeric entry.
- HUD crosshair with live property tooltip.

**Exit:** Dragging a point holds 60 FPS with the properties panel live-updating; store tests
pass headless.

---

## Phase 7 — Processes and mixing
**Goal:** Connect points into meaningful thermodynamics.

- Sensible heating/cooling, humidification, dehumidification, general linear processes.
- Air mixing by mass/energy balance, including "Winter V" mixing with condensation.
- SHR and ΔH/ΔW protractor drawing parallel reference lines.

**Exit:** Mixing and process results validated in `cargo test` against worked textbook examples;
process lines render with direction indicators.

---

## Phase 8 — HVAC macros and coil tools
**Goal:** One-click engineering output.

- Primary and Secondary Return Air Cycle macros plotting full multi-point cycles.
- Sensible/latent heat (kW) and moisture addition/removal rates.
- Apparatus Dew Point, Air Bypass Factor, cooling-coil performance lines.

**Exit:** A macro run on a known design case reproduces published cycle values.

---

## Phase 9 — Standards overlays (Layer 1)
**Goal:** Comfort and datacenter envelopes.

- ASHRAE Standard 55-2017/2020 comfort zones; ASHRAE TC 9.9 / NEBS datacenter zones.
- Zone polygons as data files, not code, so contributors can add envelopes without TS changes.

**Exit:** Overlays toggle on/off, respect the active unit system and altitude, and sit correctly
beneath points and above the grid.

---

## Phase 10 — BYOD weather data (Layer 2)
**Goal:** Large datasets without a server.

- `EpwParser` in a **Web Worker** for `.epw` and large CSV; drag-and-drop ingest.
- `bin_weather_data` in WASM, 0.5–6 degree bin increments.
- Density heatmap / scatter rendering.

**Exit:** An 8760-hour EPW file parses, bins, and renders with no main-thread jank
(verified with a performance trace, not by eye).

---

## Phase 11 — Export, import, and persistence
**Goal:** Get work out of the browser.

- SVG and DXF vector export; PDF report combining chart, flow diagram, and tables.
- CSV/Excel export of points and processes.
- `.psy` / `.json` save and load via the File System Access API, with a download fallback for
  browsers that lack it.

**Exit:** Round-trip test — save a project, reload, and the point/process set is identical.
DXF opens cleanly in a CAD viewer.

---

## Phase 12 — Customization, distribution, docs
**Goal:** Ship it and make it forkable.

- Line-styling matrix modal (color, style, width per property family).
- Dockerfile for self-hosting; GitHub Pages deploy from CI.
- README with screenshots, architecture overview, and a translation contribution guide.
- Dependency license audit across npm and crates.

**Exit:** A fresh clone builds and self-hosts via `docker run`; the license audit is clean.

---

## Resolved decisions

1. **License: MIT.** Applied in `LICENSE` and declared in the Cargo workspace and
   `web/package.json`.
2. **`RustProp` is a first-party product** owned by the maintainer, so it needs no
   third-party license audit. Phase 1 keeps it behind the `psychro-core` API anyway, so
   the dependency stays swappable and the calculation surface stays independently testable.
3. **DXF export stays in scope** for Phase 11. The writer choice (existing permissive
   crate vs. minimal hand-rolled R12) is a Phase 11 implementation detail, not a
   blocker for earlier phases.

## Still open

- **How `RustProp` is consumed by the build** — crates.io, a git dependency, or vendored
  into the workspace. This determines the Phase 1 `Cargo.toml` and whether CI needs
  credentials, so it must be settled before Phase 1 starts. It does not block Phase 0.
- **TypeScript 7 upgrade.** The scaffold pins TypeScript 6 because `typescript-eslint`
  declares `typescript <6.1.0`. Revisit once that peer range widens.
