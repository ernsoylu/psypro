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

Two gaps were identified on adoption, and both are now closed **upstream** — the rule being
that an upgrade frees needs lands in frees, and PsyPro then depends on it:

1. **Chart geometry.** `frees-core/src/props/psychro.rs` generated a *rectangular* chart —
   dry-bulb on x, humidity ratio on y — with no oblique construction and no Mollier i-x
   layout. Contributed as `frees_core::props::psychrochart`, both layouts, 7 tests.
2. **Component coverage.** `moistair.frees` shipped 19 moist-air components against a
   37-entry catalogue in `REQUIREMENTS.md` §4. Seventeen were contributed across two waves;
   `moistair.frees` now carries 36, and the catalogue is covered. See Phase 2.5c.

---

## Status

| Phase | State |
|---|---|
| 0 — Repository foundation | **Done**, CI green |
| 1 — Psychrometric core | **Superseded by frees.** The reference implementation and its 14-case ASHRAE conformance suite stay as the grading gate |
| 2 — WASM bridge | **Done** — typed handshake, IP/SI at the boundary, debug panel |
| 3 — Coordinate transformation | **Done** — oblique construction, both layouts, 22 tests |
| 2.5 — frees integration and upstream contribution | **Done** — frees is the production path; chart geometry and 17 components contributed upstream, closing the §4 catalogue |
| 4 — Application shell and theme | **Done** — shell, palette, i18n, and a test that fails the build on a literal |
| 5 — Canvas Layer 0 (base grid) | **Done** — both layouts, pan/zoom, grid cached and the cache asserted |
| 6 — Stores and interactive points | **Done** — three stores tested headless, drag round-trip measured at 61 FPS |
| 7 — Processes and equipment models | **Done** — 15 worked textbook cases, protractor exact by construction |
| 8 — Coil model, cycle macros, Process Design page | **Done** — 14 coil cases, three BF forms agree, page verified against the real engine |
| 9 — Standards overlays and industry profiles | **Done** — envelopes are data, polygons computed at altitude, profiles proven inert |
| 10 — BYOD weather data | **Done** — 8760 hours, worst frame gap 17 ms, traced not eyeballed |
| 11 — Teaching mode | **Done** — four worked examples graded against their books, every step cited |
| 12 — Export, import, and persistence | **Done** — round trip byte-identical; DXF audits clean under ezdxf |
| 13 — Customization, distribution, docs | **Done** — self-hosts via `docker run`, exit-checked for real; license audit clean |
| 14 — Process authoring and the wet coil | **Done** — the document is a graph, the draw tool draws, and a target below the dew point is a coil rather than an error. See `docs/process-authoring-plan.md` |

---

## Phase 2.5 — frees integration and upstream contribution

**Goal:** Make frees the production calculation path, and close the gaps it has for
psychrometric work by contributing to it.

### 2.5a — Adopt frees as the backend — **done**
- `psychro-core` becomes a thin adapter over `frees_core::props::propfun`, not a second
  implementation. Its formulations move behind a `reference-impl` feature used only by the
  grading tests.
- The ASHRAE conformance suite is repointed to grade **frees**, so the acceptance criterion
  transfers intact rather than being retired.
- CI checks out submodules recursively.

**Exit:** every `StatePoint` in the app is resolved by frees; the conformance suite passes
against it; the parity test keeps both implementations honest.

### 2.5b — Contribute the oblique chart geometry upstream — **done**
Offer `chart.rs` to frees as the chart-space transform behind `props/psychro.rs`, giving it
the ASHRAE oblique construction and the Mollier i-x layout it currently lacks.

**Exit:** a PR against `ernsoylu/frees-wasm` with the round-trip and straightness tests.

### 2.5c — Contribute the missing components — **done**, the catalogue is closed
`moistair.frees` now carries **36 components**, up from 19 when PsyPro adopted frees. What
frees already had — including several PsyPro had not catalogued — is: MoistAirSource/Sink,
HeatingCoil, Humidifier, MixingBox, CoolingCoil, MoistAirWallHX, MoistAirFan, MoistAirDamper,
EvaporativeCooler, CabinZone, MembraneHumidifier, MoistAirDuct, AirFilter, Diffuser, VAVBox,
EnthalpyWheel, Infiltration, AHU, Chiller, EXV/EXVCmd, AirCoil, TXV, Radiator, HeaterCore.

`CabinZone`, `HeaterCore` and `Radiator` mean the **automotive profile was already well
served** — a significant finding, since that was expected to be the thinnest of the three.

Contributed upstream in two waves, seventeen components in total:

| Wave | Contributed |
|---|---|
| 1 | SensibleAirToAirHX, DesiccantWheel, IndirectEvaporativeCooler, SteamHumidifier, ChilledBeam, FanPoweredBox |
| 2 | ApparatusDewPointCoil, FaceAndBypassCoil, HeatPipeWrapAround, TotalEnergyExchanger, LiquidDesiccantContactor, IndirectDirectEvaporativeCooler, Economizer, InductionUnit, FanCoilUnit, RadiantPanel, DOAS |

Three of the §4 entries are **configurations of one component, not components of their own**,
following frees' own precedent of one model with documented rating bands:

| §4 entry | Served by | Rating |
|---|---|---|
| Fixed plate, heat wheel, heat pipe, run-around loop, thermosiphon | `SensibleAirToAirHX` | eff 40–85%, eatr 0–10%, oacf 0.97–1.2 |
| Membrane plate, twin towers | `TotalEnergyExchanger` | eps_s/eps_L 40–75%, eatr 0–5% |
| Run-around recuperative loop | `HeatPipeWrapAround` | same topology, pumped rather than passive |

The PsyPro palette maps the catalogue name to `(component, preset)`; that mapping is a UI
concern and does not belong upstream.

**Two gaps found in frees while closing PsyPro's**, both now fixed there:

- **No apparatus-dew-point coil.** `CoolingCoil` drives the leaving air to *saturation* at a
  given temperature — a perfect coil, BF = 0. Real coils leave air at 85–95% RH. Since the
  ADP/bypass-factor construction is the centre of every psychrometric design, this was the
  largest single gap in the library, not a refinement.
- **EATR and OACF were missing from the sensible recovery family.** §4.5 names both as
  things a credible tool must not omit. Both are now required parameters — defaulting them
  to zero would answer a cross-contamination question wrongly and silently.

Adding EATR and OACF made `SensibleHeatWheel` equation-for-equation identical to
`SensibleAirToAirHX`, so the two were consolidated into one.

**Exit:** each contributed component solves and is gated by a test asserting its *defining
property*, and the governing equation in `REQUIREMENTS.md` §4 is the one implemented.

Not the frees **corpus**, deliberately: corpus fixtures are graded against golden values from
the Java reference, and none of these seventeen has a Java counterpart, so there is no golden
to grade them by. `crates/frees-core/tests/moistair_recovery.rs` and `moistair_design.rs`
(20 tests) assert what a regression would actually break instead — a sensible exchanger that
starts moving moisture, a wrap-around loop that invents energy, a coil whose three
bypass-factor forms stop agreeing, a chilled beam that condenses without saying so. All of
those stay dimensionally consistent and would sail through a residual check; they just would
not be the device any more.

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

**Done.** `src/theme.test.ts` is the gate rather than the promise: it reads the source files and
fails on a colour literal outside `theme.css`, a `var(--…)` nothing declares, a palette colour
missing from either theme, a `t('key')` the bundle has no entry for, a bundle entry nothing
renders, and a user-facing literal typed into a component — including `aria-label`, `title`,
`placeholder` and `alt`, which are the ones a translator never sees. It caught three keys added
ahead of the feature that needs them; they come back in Phase 6 with the click-to-place toggle.

---

## Phase 5 — Canvas Layer 0 (base grid)
**Goal:** A real, readable psychrometric chart on screen.

- `useChartTransform` hook: chart space → screen, owning zoom, pan, and resize.
- `PsychGrid` component consuming Phase 3 path data, styled via CSS variables.
- Grid caching keyed on units + altitude + layout; infinite pan and zoom-window controls.

**Exit:** Both chart layouts render correctly, pan/zoom stay smooth, and the grid is *not*
regenerated on pan/zoom (assert via a render counter in a test).

**Done.** `src/chart/cache.test.ts` counts `generate_base_grid` calls across 30 pans, four
zooms and ten re-renders and asserts it stays at one — and that it goes to two the moment
altitude or layout changes, because a cache that never invalidates would draw a sea-level
chart for a site in Denver.

Two things worth recording:

- **The two chart axes are scaled independently.** They carry different quantities — the
  reduced coordinate in kJ/kg_da against humidity ratio in kg/kg_da — differing by three
  orders of magnitude over a comfort-range domain. A uniform scale collapses the chart to a
  horizontal line, which is what it did on screen before this was written down. The invariant
  that *does* hold is that a zoom multiplies both by the same factor, so the aspect a fit
  establishes never changes; that is what keeps the SHR protractor readable.
- **Axis numerals are derived from the grid, never recomputed.** Every tick anchor is an
  endpoint of a curve the engine already produced, so the numerals cannot drift from the lines
  they label — and no `σ = t·(c_p,da + c_p,wv·W)` gets reimplemented in TypeScript.

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

**Done.** Measured in a real browser: **61 FPS across 89 drag moves over 1.5 s, worst frame gap
25 ms**, with the panel re-resolving every property each move (24.08 → 27.04 → 29.98 °C).
25 store and formatting tests run without a DOM.

The decision that carries the phase: **a point stores the two inputs that define it, not the
twelve properties they resolve to.** Changing elevation therefore re-resolves every point from
its own inputs rather than leaving the document full of readings taken at a pressure it is no
longer at; and a dragged point and a typed point are the same thing, so there is no "chart
point" and "manual point" to keep in step.

Dragging past saturation needed an engine change, made in `psychro-wasm` rather than worked
around in the view: `state_from_chart_coordinates_clamped` slides the point *along* the
saturation curve at the dry bulb the pointer is over. Deciding what "the saturated state here"
is remains a thermodynamic question, and TypeScript must not answer one.

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

**Done.** `crates/psychro-core/tests/process_conformance.rs` holds 15 worked cases. The
SHR = 1.0 case renders as a horizontal arrow with a horizontal protractor line and reports
`sensible = total, latent = 0.000, SHR = 1.000`.

The decision that carries the phase is **how a load is split**. The obvious way is
`q_s = ṁ·c_p,ma·Δt` with latent as the remainder; `process.rs` does the opposite, taking latent
as `ṁ·h_g,ref·ΔW` against the same `h_g,ref = 2499.86` the chart's reduced coordinate is
defined by. That makes the protractor relation `Δh/ΔW = h_g,ref/(1 − SHR)` **exact** rather than
approximate — the line drawn on the chart and the number in the panel are the same fact, and a
test asserts they agree to 1e-6 relative. Split it the other way and they disagree by a
fraction of a percent: small enough to survive review, large enough to make a reader distrust
both.

Winter V mixing is modelled rather than refused. The chord between two unsaturated states can
pass above the saturation curve because that curve is convex; the mixture then fogs, settles on
the curve at its own enthalpy, and drops the excess water out. It happens in every cold-climate
mixing box, and returning an error there is refusing to model it.

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

**Done.** The summer design case — 35 °C/40% outdoor, 24 °C/50% room, 20 kW sensible and 5 kW
latent, 20% outdoor air, supply at 13 °C — resolves in the browser to:

```
ADP 10.20 °C · BF  t 0.1746  W 0.1739  h 0.1739 · coil SHR 0.7185
air-side drop 33.41 kW · total load 33.21 kW · condensate 0.00372 kg/s
supply 1.455 m³/s · 1.772 kg/s dry air · RSHF 0.800
```

Two things worth recording:

- **The design derivation solves for the flow rather than using the one-shot.**
  `ṁ_da = q_s/(c_p,ma·Δt)` and the §4.9 load split disagree by a fraction of a percent whenever
  the humidity ratio moves, because `Δh − h_g,ref·ΔW` carries a `c_p,wv·Δ(W·t)` term a single
  `c_p,ma` cannot. Sizing by one and reporting by the other produces a design whose own numbers
  do not add up — 20.06 kW of load delivered by air sized for 20.00 kW. The flow is now solved
  so the supply air absorbs *precisely* the stated loads under the decomposition the panel
  prints, and a test asserts that on three different load splits.
- **Resolving an exactly saturated state used to be impossible.** Asking for RH = 1 produced a
  humidity ratio that came back as RH = 1.0000000000000002 one round trip later, which the
  backend refuses as out of range — so the saturation curve could only be approached, never
  reached. Apparatus dew points live on that curve, as do evaporative outlets. `from_db_w` now
  treats a state inside its own supersaturation tolerance as saturated by definition.

The page tests run against the **real engine**, with the module loaded off disk rather than
mocked, so "the three bypass-factor forms agree in the rendered page" is a claim about the coil
rather than about a stub.

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

**Done.** `src/data/profiles.test.ts` resolves 24 °C / 50% RH under all three profiles and
asserts the eleven properties are identical *as strings*, so a difference in the last bit fails
rather than rounding away.

**An envelope is stored as limits, never as a polygon.** That is the decision the phase turns
on. A relative-humidity bound is a *curve* whose shape depends on barometric pressure, so an
outline traced once at sea level is wrong in Denver — and wrong invisibly, which is worse than
wrong loudly. Storing what the standard publishes and computing the shape means a contributor
adds an envelope by writing down its bounds and nothing else, which is what §5 asks for.

Membership is judged against the limits rather than the drawn outline, so the answer to "is
this room compliant?" does not depend on how finely the zone was sampled for the screen. The
check reports *how far* outside and *which bound*, because a data centre two kelvin over is a
different conversation from one twelve kelvin over, and the bound that is violated says which
mechanism is at risk.

Every envelope carries its rationale into the UI, per §10.3: a dew-point ceiling that exists to
stop conductive anodic filament growth is a different constraint from one that exists for
comfort, and a reader who knows which is which can judge exceeding it.

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

**Done, and the trace was the point.** The first version passed by eye and failed by
measurement:

```
before   39.0 s wall ·   7 frames · worst frame gap 38 908 ms
after     2.3 s wall · 139 frames · worst frame gap      17 ms
```

Two defects, neither visible without the trace:

- **The year was resolved once per question.** Binning, free-cooling hours and each visible
  envelope each called `StatePoint::from_db_dp` per row — ten properties including an iterative
  wet-bulb solve, four times over. Resolving once into the four quantities the analyses
  actually need, and computing the wet bulb only for hours that reach the test needing it, took
  the Rust suite from 20 s to 3.6 s on its own.
- **The engine was on the main thread.** Even resolved once, 2.3 s is a 2.3-second frozen page.
  The worker now owns the WASM instance, the parsed arrays and every analysis; the main thread
  receives plain numbers. Re-binning at a new increment is a message, not a re-read.

A third came out of the render trace: the heatmap asked the engine for a chart position per
lattice corner, resolving a full state each time — a few thousand round trips and a 467 ms
frame gap. `chart_lattice` returns the whole lattice in one call, because the transform is pure
geometry and never needed the thermodynamics.

The parser rejects EPW's `99.9` missing-value sentinel rather than binning it: a spike of
phantom hours at the right-hand edge of the chart looks exactly like a hot climate.

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

**Done.** Four examples ship as data, each carrying its source, what it teaches, and the values
its book reports — *with the tolerance those values were printed to*. The tolerance is part of
the citation rather than a global fudge: a book printing 47.9 kJ/kg is not claiming 47.9087, and
grading against more digits than were published tests the typesetting rather than the physics.

`explain` lives in the engine, not the view, and that placement is the phase's real decision:
**only the engine knows what was substituted.** A "show the working" panel written in TypeScript
would have to re-derive the intermediate quantities to display them — a second implementation
of the same physics, in the one place where a divergence would be actively teaching the wrong
thing.

Expanding the enthalpy step on the 24 °C / 50% RH example shows:

```
h = 1.006·t + W·(2499.86 + 1.84·t)
47.909 = 1.006 × 24.00 + 0.009340 × (2499.86 + 1.84 × 24.00)
ASHRAE RP-1485
⚠ The widely copied 2501 and 1.86 are the older values. Using them shifts every enthalpy,
  and therefore every coil load, by a small consistent amount.
```

Every step carries a reference, because "trust me" is the one thing a teaching tool must not
say. The §3.2 traps are named beside the numbers they apply to — the frost-point caution
appears only below freezing — and a test asserts all three are present.

The ideal-gas toggle now *measures* the correction rather than asserting it. Telling a student
the enhancement factor is about half a percent is a fact they must take on trust; a number that
moves when they flip a switch is not.

---

## Phase 12 — Export, import, and persistence
**Goal:** Get work out of the browser.

- SVG and DXF vector export; PDF report combining chart, flow diagram, and tables.
- CSV/Excel export of points and processes.
- `.psy` / `.json` save and load via the File System Access API, with a download fallback for
  browsers that lack it.

**Exit:** Round-trip test — save a project, reload, and the point/process set is identical.
DXF opens cleanly in a CAD viewer.

**Done.** The round trip is byte-identical, and a test asserts it twice — save, reload, save
again, and the two files must compare equal as strings, so a format that loses a digit on read
or invents one on write fails rather than "mostly survives". A humidity ratio typed as
0.0093401 comes back as 0.0093401, because **the file stores inputs, never derived values**:
what the engine made of them belongs to the elevation it resolved them at, and a document
opened at another altitude re-resolves every point from its own definition rather than carrying
stale readings across. The version is checked on read, and a file from a *newer* version is
refused with a message rather than guessed at. Save uses the File System Access API where the
browser has it and falls back to a download where it does not; a save that fails says so in a
banner, because failing silently is worse than failing loudly.

Three export formats, each verified outside the app:

- **SVG** — 158 polylines with zero `var(--…)` in the output. A variable that resolves in the
  app is a literal string in a file opened elsewhere, so every colour is resolved before the
  XML is written, and a test asserts none survive.
- **CSV** — the unit lives in the header row, so a number cannot leave the building without
  its unit.
- **DXF** — validated with **ezdxf** rather than claimed compliant: audit errors 0, all nine
  `PSY-*` layers declared, saturation on its own layer, coordinates in model space (°C and
  g/kg × scale), never pixels.

The DXF carries the correction worth recording. The first version declared
`$ACADVER = AC1009` (R12) while emitting `LWPOLYLINE` entities — which are **not** an R12
entity; they enter the format at R2000. A lenient reader opens that file and says nothing, a
strict reader refuses it, and both readings of "opens cleanly" are true at once. The file now
declares **AC1015**, and the test asserts both the version it carries and the one it does not.

The PDF report stays open. It is a rendering of the Report page — chart, flow diagram, tables
on one document — and that page does not exist yet (its tab is still disabled). Exporting a
report the app cannot show would be a PDF-shaped promise, so the format ships when the page
does.

---

## Phase 13 — Customization, distribution, docs
**Goal:** Ship it and make it forkable.

- Line-styling matrix modal (color, style, width per property family).
- Dockerfile for self-hosting; GitHub Pages deploy from CI.
- README with screenshots, architecture overview, and a translation contribution guide.
- Dependency license audit across npm and crates.

**Exit:** A fresh clone builds and self-hosts via `docker run`; the license audit is clean.

**Done.** The exit check ran for real, not by inspection: `docker build` from a clean
context, `docker run`, and HTTP 200 for the index, an SPA deep link, and a hashed bundle
asset. It caught a real bug on the way — the image's nginx 500'd on every request because
the official image compiles nginx with `--prefix=/etc/nginx`, so a server block without an
explicit `root` silently serves from `/etc/nginx/html`; the stock `default.conf` always sets
it, ours did not. The fix is in `docker/nginx.conf` with the reason written next to it.

- **Line-styling matrix.** Color, dash, and width per property family in a modal over
  `useStyleStore`, rendered on canvas and honoured by SVG export — where every colour is
  resolved to a literal before the XML is written, because a `var(--…)` is a dead string in a
  file opened elsewhere. 28 tests across the matrix, the modal, the store, and the export.
- **Distribution.** Three ways to run it, all wired to CI: GitHub Pages deploys on every
  merge to `main` (`deploy.yml`, and only then); a three-stage Dockerfile mirrors CI's
  toolchain pins stage for stage; and pushing a `v*` tag builds the image and publishes it
  to `ghcr.io` alongside a GitHub Release (`release.yml`). The first tag is `v0.1.0`.
- **README.** Screenshots from the running app, the three-layer architecture in a diagram
  worth its size, quick start, all three hosting options, and the translation guide:
  `en.json` is the schema, `TranslationKey` is derived from it, and `BUNDLES` is typed
  against it — so a translation that misses a key or invents one is a compile error, and
  adding a language touches one JSON file and one registry, never a component.
- **License audit** (`docs/license-audit.md`). The runtime tree that ships — 12 packages —
  is all MIT. The full dev tree's only copyleft is `lightningcss` (MPL-2.0), Vite's
  build-time CSS transformer: it never ships, and its output is not a derivative work; the
  rationale is recorded in the audit rather than assumed. All 69 crates are permissive, and
  every disjunctive expression among them offers a MIT path. Verdict: clean.

The repository was tidied for the occasion: browser-automation scratch space is gitignored
and untracked, and the screenshots live curated under `docs/screenshots/`.

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
