# PsyPro — Phased Development Plan

Each phase is **atomic**: it lands as one pull request, leaves `main` in a working and
demonstrable state, and has an exit criterion that can be checked without reading the diff.
A phase is not "done" because the code exists — it is done when its exit criterion passes in CI.

---

## The calculation backend: frees

**PsyPro does not implement psychrometrics. `frees` does.**

```
PsyPro  →  frees-core  →  rustprop  →  CoolProp 8.0.0-grade properties
(UI, chart,   (equation engine,   (pure-Rust CoolProp port,
 documents)    component library)   `humid-air` feature)
```

`frees-wasm` is a first-party project of the maintainer, MIT-licensed, vendored here as a
git submodule at `vendor/frees-wasm`. It is an equation-solving and simulation engine — a CAS,
a DAE/ODE solver, a component library, parametric and uncertainty analysis — with a moist-air
property path that is **graded in CI against 912 CoolProp 8.0.0 reference points**.

This settles the question that blocked Phase 1 from the start. `RustProp` is consumed *through*
frees-core, as a git dependency pinned to tag `v0.1.0` with the `humid-air`, `heos` and
`incompressible` features. There is no separate integration to design.

Two properties of frees-core make it fit PsyPro's architecture without adaptation:

* It is **target-agnostic and free of `wasm-bindgen`** by its own hard rule, exactly as
  `psychro-core` is. The WASM boundary stays in one place in each project.
* Its humid-air entry point is `props::propfun::ha_props_si`, the CoolProp `HAPropsSI`
  signature, so every state-point query is one call with explicit inputs — matching the
  stateless-engine rule in `REQUIREMENTS.md` §3.

**Measured agreement** between this repo's own reference implementation and the frees path,
at sea level (`crates/psychro-core/tests/frees_backend_parity.rs`):

| Quantity | Worst deviation | Over |
|---|---|---|
| Saturation humidity ratio | 6.9e-4 relative | 0–50 °C |
| Specific enthalpy | 0.016 kJ/kg_da | −5 to 34 °C, 50–95% RH |
| Thermodynamic wet-bulb | 0.008 K | 24–34 °C |

The residual is this repo's linearised enhancement factor against rustprop's full treatment.
**frees is the authority**; `psychro-core`'s formulations are retained as the independent
grading reference, not as the production path.

## What PsyPro adds, and what it contributes back

PsyPro is the psychrometric *application*: the chart, the document model, the industry
profiles, the teaching affordances. Where the engine is missing something PsyPro needs, the
fix goes **upstream into frees** rather than being reimplemented here.

Two gaps are already identified:

1. **Chart geometry.** `frees-core/src/props/psychro.rs` generates a *rectangular* chart —
   dry-bulb on x, humidity ratio on y — with no oblique construction and no Mollier i-x
   layout. `psychro-core/src/chart.rs` has the derived oblique transform for both layouts.
   That is a contribution, not a local workaround.
2. **Component coverage.** `moistair.frees` and `ac.frees` ship 26 components. The catalogue
   in `REQUIREMENTS.md` §4 has 37, and the gaps are listed in Phase 2.5 below.

---

## Status

| Phase | State |
|---|---|
| 0 — Repository foundation | **Done**, CI green |
| 1 — Psychrometric core | **Superseded by frees.** The reference implementation and its 14-case ASHRAE conformance suite stay as the grading gate |
| 2 — WASM bridge | **Done** — typed handshake, IP/SI at the boundary, debug panel |
| 3 — Coordinate transformation | **Done** — oblique construction, both layouts, 22 tests |
| 2.5 — frees integration and upstream contribution | **Next** |
| 4–13 | Not started |

---

## Phase 2.5 — frees integration and upstream contribution

**Goal:** Make frees the production calculation path, and close the gaps it has for
psychrometric work by contributing to it.

### 2.5a — Adopt frees as the backend
- `psychro-core` becomes a thin adapter over `frees_core::props::propfun`, not a second
  implementation. Its formulations move behind a `reference-impl` feature used only by the
  grading tests.
- The ASHRAE conformance suite is repointed to grade **frees**, so the acceptance criterion
  transfers intact rather than being retired.
- CI checks out submodules recursively.

**Exit:** every `StatePoint` in the app is resolved by frees; the conformance suite passes
against it; the parity test keeps both implementations honest.

### 2.5b — Contribute the oblique chart geometry upstream
Offer `chart.rs` to frees as the chart-space transform behind `props/psychro.rs`, giving it
the ASHRAE oblique construction and the Mollier i-x layout it currently lacks.

**Exit:** a PR against `ernsoylu/frees-wasm` with the round-trip and straightness tests.

### 2.5c — Contribute the missing components
`moistair.frees` and `ac.frees` cover 26 of the catalogue's 37. What frees already has —
including several PsyPro had not catalogued — is: MoistAirSource/Sink, HeatingCoil,
Humidifier, MixingBox, CoolingCoil, MoistAirWallHX, MoistAirFan, MoistAirDamper,
EvaporativeCooler, CabinZone, MembraneHumidifier, MoistAirDuct, AirFilter, Diffuser, VAVBox,
EnthalpyWheel, Infiltration, AHU, Chiller, EXV/EXVCmd, AirCoil, TXV, Radiator, HeaterCore.

`CabinZone`, `HeaterCore` and `Radiator` mean the **automotive profile is already well
served** — a significant finding, since that was expected to be the thinnest of the three.

Gaps, in the order they earn their place:

| Family | Missing |
|---|---|
| Energy recovery | Fixed plate, membrane plate, sensible heat wheel, heat pipe, run-around coil loop, thermosiphon, twin towers |
| Dehumidification | Solid desiccant wheel, liquid desiccant, heat-pipe wrap-around |
| Coils | Face-and-bypass, run-around recuperative loop |
| Evaporative | Indirect (IEC), indirect/direct two-stage |
| Airside | Economizer changeover |
| Terminal units | Fan-powered box, induction unit, active and passive chilled beam, fan coil unit, radiant panel, DOAS |

**Exit:** each contributed component has a fixture in the frees corpus that solves, and the
governing equation in `REQUIREMENTS.md` §4 is the one implemented.

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
  **Designed** in `design.pen`; components not in the active cycle render as inactive rather
  than being hidden, so the available palette stays visible without implying they are running.

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

## Beyond the current plan

Three modules the maintainer has flagged. They are recorded here with the same shape as the
phases above so they can be scheduled rather than remembered, and they share a theme: the
current plan starts at a *state point*, but real design work starts one step earlier, at a
**load**, and ends one step later, at **equipment sized against a distribution network**.

### Load calculation
**The starting point of any HVAC design** — building, house, automotive cabin or data centre —
is the load. Without it, a psychrometric chart is a calculator waiting for numbers the user
has had to find elsewhere.

- Fundamental first, for **all four applications**, with a small set of required inputs.
- Advanced options let the user refine the estimate as more data becomes available, rather
  than demanding a full building model up front.
- Sources: the ASHRAE and Carrier references in the `Frees` NotebookLM notebook — Spitler's
  *Load Calculation Applications Manual* (RTSM and heat-balance methods) is already there,
  alongside the automotive cabin-load and TC 9.9 material.
- Feeds §4.3 directly: room sensible and latent load → RSHF → supply airflow → coil selection.
  That chain already exists in the plan and currently begins with numbers typed in by hand.

**Exit:** a worked load from each of the four application types reproduces its published
result, and hands off to the existing supply-airflow derivation without re-entry.

### Hydronic loops — brine, coolant, pumps and fans
Most HVAC systems move heat with a liquid before they move it with air. Chilled water, glycol
brines and automotive coolant loops carry the duty from the coil to the plant.

- Loop heat transfer plus the **electrical consumption** of the machines that drive it.
- Driven by **pump and fan curves**, which `frees-wasm` already supports — `liquid.frees`,
  `hydraulic.frees` and the `pumpmap` / `fanmap` components are in the library today, so this
  is largely an integration and UI problem rather than new physics.

**Exit:** a chilled-water loop closes its energy balance against the air-side coil duty, and
reports pump power from a real curve rather than an assumed efficiency.

### Duct and pipe sizing
The distribution network is what actually sets the pump and fan duty, so sizing it is the
step between a load and equipment selection.

- Size ducts and pipes, then size the pumps and fans **against that network** rather than
  against a guessed pressure drop.
- `MoistAirDuct` (Darcy friction on the moist-air stream) and the hydraulic resistance
  library already give the pressure-drop physics; what is missing is the sizing method and
  the network editor.

**Exit:** a sized network produces a system curve that intersects a real pump or fan curve at
the design flow.

---

*Original notes, kept verbatim:*

## Future Ideas
-   The starting point of an HVAC System Design either building or house or Automotive or Datacenter
    is calculating the load. We need to add load calculator for various application. We can rely on 
    the ASHRAE and Carier books in the notebooklm-Frees notebook and create a comprehensive calculator
    it should be simple and fundamental first for all applications with advanced options user can improve
    and precise the calculation with more data.

-   In the HVAC applications brine and coolant is mostly used for transferring the heat from one place to other  place so we can also add this heat transfer and electrical consumption of these via adding some additional data like pump curve, fan curve which is already compatible with frees-wasm.
-   Another open point duct and piping design which we can size pumps and fans based on this design like load calculation this is another module we can add in the future.
-
