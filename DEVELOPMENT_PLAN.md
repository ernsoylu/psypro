# PsyPro — Phased Development Plan

Each phase is **atomic**: it lands as one pull request, leaves `main` in a working and
demonstrable state, and has an exit criterion that can be checked without reading the diff.
Phases are ordered so that nothing is built on top of an unverified layer. A phase is not
"done" because the code exists — it is done when its exit criterion passes in CI.

Dependencies are noted where a phase can be parallelised; everything else is strictly serial.

## Status

| Phase | State |
|---|---|
| 0 — Repository foundation | **Done**, CI green |
| 1 — Rust thermodynamic core | **Substantially done** — engine + 14-case conformance suite landed; `RustProp` wrapping and fog region remain |
| 2 — WASM bridge | **Done** — typed handshake, IP/SI at the boundary, debug panel |
| 3 — Coordinate transformation | Next |
| 4–13 | Not started |

## Findings that reshaped this plan

A research pass over the ASHRAE source library (Gatley, *Understanding Psychrometrics* 3rd
ed.; RP-1485; Spitler's *Load Calculation Applications Manual*; TC 9.9; automotive A/C
sources) changed the scope in ways later phases depend on. They are recorded here so nobody
re-litigates them mid-build.

1. **The formulations are non-negotiable and now pinned by tests.** IAPWS-IF97 over water,
   IAPWS-06/08 over ice, RP-1485 constants (`2499.86`/`1.84`, not `2501`/`1.86`), real-gas
   enhancement factor on by default. See `REQUIREMENTS.md` §3.1.
2. **Data centres run at SHR ≈ 0.95–1.0**, so their process lines are essentially
   **horizontal**. Any default, heuristic, or auto-scaling tuned to the comfort-range SHR of
   0.65–0.85 will mislead that audience. Phase 8's process model and Phase 9's overlays must
   both handle the near-unity case as a first-class path, not an edge case.
3. **Automotive's binding constraint is fogging**, `t_dp,cabin ≥ t_glass,inner`. That check is
   the reason the automotive profile needs the sub-freezing branch of the engine, and it makes
   the ice-side formulations load-bearing rather than completeness for its own sake.
4. **Three distinctions must survive into the UI**, not just the engine: RH vs. degree of
   saturation, thermodynamic vs. psychrometer wet-bulb, and dry-air-basis mass flow. These are
   the field's most common errors; they drive Phase 6's property panel and Phase 11's teaching
   affordances.

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

**Status: substantially landed.** `psychro-core` now implements the formulations below with a
14-case conformance suite; `RustProp` integration and the fog region remain.

- IAPWS-IF97 saturation over liquid water, IAPWS-06/08 over ice — both branches, always.
- ASHRAE RP-1485 constants; real-gas enhancement factor with an ideal-gas mode for teaching.
- `Atmosphere` carries barometric pressure and the real-gas flag as explicit inputs.
- Enthalpy, specific volume, dry-air mass flow, relative humidity **and** degree of saturation.
- Thermodynamic wet-bulb with separate liquid and ice branches; dew/frost point by inversion.
- Altitude → pressure via the ICAO standard atmosphere.
- Remaining: `RustProp` wrapping, the `InputState` enum surface, fog region, high-pressure
  validation to 100 PSI.

**Exit:** `cargo test -p psychro-core` passes the ASHRAE/IAPWS reference table including
sub-zero and altitude cases. Achieved for the items above.

---

## Phase 2 — WASM bridge and typed handshake
**Goal:** Prove the Rust↔TypeScript contract before anything depends on it.

**Status: done.**

- `InputState` (DbtWbt / DbtRh / DbtDewPoint / DbtHumidityRatio / DbtEnthalpy),
  `StatePointInput`, `StatePointOutput` exposed through `wasm-bindgen`, with a
  `Result<_, JsValue>` error surface carrying readable messages.
- **IP/SI conversion lives only at this boundary.** The engine computes exclusively in SI, so
  an IP answer cannot disagree with its SI equivalent by more than float rounding.
- `StatePointOutput` reports relative humidity and degree of saturation as separate fields,
  and labels specific volume as the dry-air basis — the §3.2 distinctions carried across the
  boundary rather than lost at it.
- Supersaturated inputs are rejected with an explicit message pointing at the unmodelled fog
  region, rather than returning a quietly wrong state.
- `web/src/psychro.ts` re-exports the generated bindings; no hand-written type mirrors.
- Debug panel drives every input mode, the unit toggle and the ideal-gas toggle.

**Exit:** met. `tsc --noEmit` passes against the generated `.d.ts` only; 7 bridge tests cover
IP/SI equivalence, altitude in both unit systems, cross-mode agreement, the ideal-gas
difference, rejection of unphysical inputs, and the sub-freezing path.

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
- Properties panel with two-way binding: click-to-place *and* manual numeric entry. It shows
  **relative humidity and degree of saturation side by side**, labels wet-bulb as
  *thermodynamic*, and states the dry-air basis on every extensive quantity
  (`REQUIREMENTS.md` §3.2) — the panel is where those distinctions either survive or get lost.
- HUD crosshair with live property tooltip.

**Exit:** Dragging a point holds 60 FPS with the properties panel live-updating; store tests
pass headless.

---

## Phase 7 — Processes and equipment models
**Goal:** Connect points into meaningful thermodynamics.

Elementary processes (`REQUIREMENTS.md` §4.1):
- Sensible heating / cooling (`W` constant — horizontal).
- Cooling with dehumidification.
- Adiabatic mixing on a dry-air mass basis, including "Winter V" mixing where the mix line
  crosses saturation and condensation occurs.
- Steam (isothermal) humidification, `ṁ_steam = ṁ_da·(W_target − W_in)`.
- Evaporative (adiabatic) humidification along constant wet-bulb, with saturation
  effectiveness `ε_w = (t_in − t_out)/(t_in − t_wb,in)`.
- General linear process between two arbitrary states.

Equipment models (§4.2):
- **Preheat / reheat coils** — sensible, `q = ṁ_da·c_p,ma·Δt`.
- **Airside economizer** — dry-bulb or enthalpy changeover, reporting operating hours.
- **Energy recovery (ERV/HRV)** — sensible and latent effectiveness
  `ε_s = (t_oa,in − t_oa,out)/(t_oa,in − t_ex,in)`, `ε_L` likewise on `W`.
- SHR and Δh/ΔW protractor; the scales relate by `Δh/ΔW = 2499.86/(1 − SHR)`.

**Exit:** `cargo test` reproduces worked textbook examples for mixing, humidification and
recovery. A horizontal (SHR = 1.0) process renders and reports correctly — the data-centre
case, which must not be treated as degenerate.

---

## Phase 8 — Coil model, cycle macros, and the Process Design page
**Goal:** One-click engineering output, and the page that drives it.

- **Cooling coil** — apparatus dew point as the intersection of the extended process line
  with saturation. Bypass factor exposed in all three equivalent forms so results can be
  checked against any textbook:
  `BF = (t_lvg − t_adp)/(t_ent − t_adp) = (W_lvg − W_adp)/(W_ent − W_adp) = (h_lvg − h_adp)/(h_ent − h_adp)`.
  Coil SHR `= c_p,ma·(t_ent − t_lvg)/(h_ent − h_lvg)`. Total load
  `q = ṁ_da·(h_ent − h_lvg) − ṁ_cond·h_f,cond` — the condensate term is small but must not be
  silently dropped.
- **Design derivation** (§4.3) — RSHF room condition line, supply airflow
  `ṁ_da = q_s,room/(c_p,ma·(t_room − t_SA))`, `V̇ = ṁ_da·v_SA`.
- **Cycle macros** — primary and secondary return-air cycles computed and plotted in one
  action, reporting sensible/latent/total load and moisture rates.
- **Process Design page** — the AHU schematic (OA → recovery → mixing → preheat → cooling →
  reheat → fan → room → return), each block bound to its process object, with the results
  strip and coil calculators alongside. This is the page the data table and chart both feed.

**Exit:** A macro run on a known design case reproduces published cycle values, and the coil's
three bypass-factor forms agree to within tolerance on the same case.

---

## Phase 9 — Standards overlays and industry profiles (Layer 1)
**Goal:** Comfort and equipment envelopes, and the profiles that select them.

- ASHRAE Standard 55 comfort zones (2017/2020).
- ASHRAE TC 9.9 recommended **and** allowable A1–A4 envelopes, with the published values in
  `REQUIREMENTS.md` §5 — note the recommended dew-point floor is **−9 °C**, far below the
  comfort band, so the envelope is much taller than a comfort zone.
- **Industry profiles** (§10) — HVAC / automotive / data centre. A profile preselects
  envelopes, default states, process palette and report template; it never changes the
  thermodynamics.
- Automotive profile carries the fogging check `t_dp,cabin ≥ t_glass,inner`.
- Envelopes ship as **data files, not code**, so a contributor can add one without touching
  TypeScript.

**Exit:** Overlays toggle, respect the active unit system and altitude, and sit correctly
beneath points and above the grid. Switching profile changes only presentation and defaults —
a state point's computed properties are byte-identical across profiles.

---

## Phase 10 — BYOD weather data (Layer 2)
**Goal:** Large datasets without a server.

- `EpwParser` in a **Web Worker** for `.epw` and large CSV; drag-and-drop ingest.
- `bin_weather_data` in WASM, 0.5–6 degree bin increments.
- Density heatmap / scatter rendering.
- **Bin analysis against envelopes** — hours inside/outside a selected envelope, and
  economizer / evaporative / mechanical-cooling hour counts. This is what makes the data-centre
  and economizer workflows real rather than decorative.

**Exit:** An 8760-hour EPW file parses, bins, and renders with no main-thread jank
(verified with a performance trace, not by eye).

---

## Phase 11 — Teaching mode
**Goal:** The half of the product's purpose that is not load calculation.
*Parallelisable with Phase 10.*

- **Show the working** — any computed property expands to reveal the equation, the substituted
  values, and the reference it comes from.
- **Name the trap** — where a quantity is commonly confused with another (§3.2), show both
  rather than silently picking one.
- **Ideal-gas toggle** — switching off the enhancement factor shows students the size of the
  real-gas correction instead of hiding it. The engine already supports this via `Atmosphere`.
- **Process animation** — stepping along a process line updates every property live.
- **Worked examples** as loadable project files, traceable to their textbook source.

**Exit:** A worked example from a named textbook loads, and its reported values match the book
within the documented tolerance, with each step's equation inspectable.

---

## Phase 12 — Export, import, and persistence
**Goal:** Get work out of the browser.

- SVG and DXF vector export; PDF report combining chart, flow diagram, and tables.
- CSV/Excel export of points and processes.
- `.psy` / `.json` save and load via the File System Access API, with a download fallback for
  browsers that lack it.

**Exit:** Round-trip test — save a project, reload, and the point/process set is identical.
DXF opens cleanly in a CAD viewer.

---

## Phase 13 — Customization, distribution, docs
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

- **How `RustProp` is consumed by the build** — crates.io, a git dependency, or vendored into
  the workspace. **This blocks the rest of Phase 1.** `psychro-core` currently carries its own
  reference implementation of the formulations, and the conformance suite is written to be
  independent of who does the arithmetic, so the decision changes the `Cargo.toml` and whether
  CI needs credentials — not the tests. Everything from Phase 2 onward proceeds without it.
- **TypeScript 7 upgrade** — the scaffold pins TypeScript 6 because `typescript-eslint`
  declares `typescript <6.1.0`. Revisit once that peer range widens.
- **Fog region** — saturation vs. mixture enthalpy above the saturation line. Deferred from
  Phase 1; needed before the automotive profile's pull-down cases in Phase 9.
- **`jetli/wasm-pack-action` targets the deprecated node20 runtime.** Cosmetic today. If
  GitHub drops node20, replace it with a pinned `cargo install wasm-pack --version 0.15.0`.
