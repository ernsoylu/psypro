# Product Requirements Document: PsyPro Web Application (Open-Source Edition)

> **Naming note.** This project is **PsyPro**. HDPsyChart is a separate, proprietary
> product referenced only as an early functional benchmark for what a psychrometric
> chart tool should do. PsyPro is an independent open-source implementation: do not
> copy its assets, branding, or code, and do not describe PsyPro as a version, clone,
> or successor of it.

## 0. Purpose and Audience

PsyPro is a **free, comprehensive and accurate engineering tool for designing air-conditioning
systems and processes**, and equally a **teaching tool** that makes psychrometric processes
legible to engineering students.

Two goals, one product. Every feature must serve at least one and must not compromise the
other: an answer that is fast but wrong fails the engineer, and an answer that is right but
opaque fails the student.

**Users:** design engineers, system engineers, process engineers, students and educators.

**Industries:** building HVAC, automotive cabin climate control, and data centre cooling.
These share one thermodynamic core but differ sharply in loads, constraints and the envelopes
they design against (see §10).

**Primary references:** D. P. Gatley, *Understanding Psychrometrics* 3rd ed. (ASHRAE);
ASHRAE RP-1485; ASHRAE Handbook—Fundamentals; ASHRAE Standards 55, 62.1, 90.1;
ASHRAE TC 9.9; Spitler, *Load Calculation Applications Manual* 2nd ed. (ASHRAE);
Stoecker, *Refrigeration and Air Conditioning*; Dossat, *Principles of Refrigeration*.

## 1. Open-Source Philosophy & Licensing
*   **Licensing:** Open-source license (exact license TBD). All selected third-party dependencies, libraries, and Rust crates must be audited to ensure compliance with permissive open-source standards (e.g., MIT, Apache 2.0).
*   **Community Contributions:** Architecture must prioritize modularity and strict separation of concerns (Calculation vs. State vs. UI) to allow independent community contributions.
*   **Local Execution:** The application must be capable of running entirely locally or self-hosted via Docker without reliance on proprietary external APIs.

## 2. System Architecture & Technology Stack
*   **Frontend Framework:** React built with **TypeScript (TSC)** for strict type safety across UI and business logic.
*   **State Management:** Zustand (or Redux) utilizing strict TypeScript interfaces for handling complex thermodynamic application states, point collections, and UI toggles.
*   **Thermodynamic Backend:** Rust compiled to WebAssembly (WASM) utilizing the `RustProp` library for zero-latency client-side calculations.
*   **WASM Bridge:** `wasm-bindgen` generating TypeScript definitions (`.d.ts`) to ensure Rust structs map directly to TypeScript interfaces across the language barrier.
*   **Rendering Engine:** HTML5 `<canvas>` via React-Konva (or custom WebGL/Canvas API) utilizing a strict Z-index layering pipeline.
*   **CI/CD & Deployment:** GitHub Actions for automated Rust testing, WASM compilation, and frontend building. Deployable to free-tier static hosting (e.g., GitHub Pages, Vercel, Netlify).

## 3. Core Psychrometric Engine (`RustProp` / WASM)

Accuracy is the product. The engine must reproduce ASHRAE's published tables, not merely
look plausible on a chart. Each item below names the governing formulation; a conformance
test suite pins them against published reference values.

### 3.1 Governing formulations (non-negotiable)

*   **Saturation vapour pressure — two phases, never one.**
    *   Over liquid water (`t ≥ 0 °C`): **IAPWS-IF97** region-4 equation.
    *   Over ice (`t < 0 °C`): **IAPWS-06/08** sublimation line.
    *   A single Magnus/Antoine fit extended below freezing overstates saturation pressure by
        **>20% at −20 °C**. The ice branch is required, not a refinement.
*   **Humidity ratio:** `W = 0.621945 · f_s · p_wv / (p_bar − f_s · p_wv)`, with
    `M_wv/M_da = 0.621945` and its reciprocal `1.607858`.
*   **Real-gas enhancement factor `f_s`** (≈1.00475 at sea level) is applied by default —
    ASHRAE's tables are real-gas, and omitting it biases `W` low by ~0.5%. An ideal-gas mode
    is exposed for teaching, clearly labelled.
*   **Specific enthalpy:** `h = 1.006·t + W·(2499.86 + 1.84·t)` kJ/kg_da, using the RP-1485
    reference enthalpy **2499.86** and vapour specific heat **1.84** — *not* the widely
    copied `2501`/`1.86`, which shift every derived value.
*   **Specific volume:** `v = 287.042·(t+273.15)·(1 + 1.607858·W) / p_bar` m³/kg_da.
*   **Thermodynamic wet-bulb** by adiabatic-saturator balance, with **separate branches**:
    liquid water added above 0 °C (`2499.86`, `Δcp = 2.346`, `cp_liq = 4.186`) and ice below
    (`2833.28`, `Δcp = −0.346`, `cp_ice = 2.0`).
*   **Dew point / frost point** as the inverse of the saturation curve, consistent with the
    phase branches by construction.
*   **Barometric pressure from altitude** via the ICAO standard atmosphere. Altitude is a
    required input: at 1600 m, `W` for a given `t`/RH is ~20% above sea level.

### 3.2 Distinctions the UI must not blur

Gatley identifies these as the field's most common errors. PsyPro must get them right *and*
teach them:

*   **Relative humidity `RH = p_wv/p_ws` is not degree of saturation `μ = W/W_s`.** They agree
    only at 0% and 100%. Both are displayed, separately labelled.
*   **Thermodynamic wet-bulb is not psychrometer wet-bulb.** The engine computes the
    thermodynamic property; any measured-wet-bulb input is labelled as such.
*   **Humidity ratio is not specific humidity** (`m_wv/m_da` vs `m_wv/m_total`).
*   **Mass balances use dry-air mass flow** `ṁ_da = V̇ / v_da`, never `V̇ · ρ_moist`. Dry-air
    mass is what is conserved across every process. Moist-air density is reported for
    reference only and must never drive a load calculation.
*   **Air does not "hold" moisture.** Wording in UI and docs follows Dalton's law of partial
    pressures; no "capacity to hold water" phrasing anywhere.

### 3.3 Ranges, layouts and performance

*   **Dual chart layouts:** ASHRAE format (dry-bulb vs. humidity ratio) and the Mollier i-x
    diagram (enthalpy vs. humidity ratio).
*   **Units:** instant IP/SI toggling.
*   **Range:** sub-zero through high-pressure operation (to 100 PSI); the chart must be able to
    display the sub-freezing region, not just the comfort band.
*   **Coordinate transformation:** bi-directional mapping between screen `(x, y)` and physical
    `(T_db, W)`, accounting for skewed axes.
*   **Performance:** 60 FPS calculation and render during point drag.

## 4. Process Analysis & Equipment Models

### 4.1 The process vocabulary

Every component reduces to one or more of these vectors on the chart. The tool models the
*vectors*; components are named configurations of them. Directions below are for the ASHRAE
layout (T_db horizontal, W vertical).

| Process | Direction | Held constant |
|---|---|---|
| Sensible heating | → right | `W`, `t_dp`, `p_wv` |
| Sensible cooling | ← left | `W`, `t_dp`, `p_wv` |
| Humidification only (isothermal) | ↑ up | `t_db` |
| Dehumidification only | ↓ down | `t_db` |
| Evaporative cooling / adiabatic humidification | ↖ up-left | `t_wb` (≈ `h`) |
| Desiccant dehumidification | ↘ down-right | `t_wb` (≈ `h`) |
| Cooling with dehumidification | ↙ toward ADP | — |
| Heating with humidification | ↗ | — |
| Adiabatic mixing | straight line between the two states | — |
| Total-energy (enthalpy) exchange | straight line toward the other stream's state | — |

**Desiccant dehumidification is the mirror image of evaporative cooling** — the latent heat
released as vapour is sorbed reappears as sensible heat, so the air leaves *warmer and drier*.
A tool whose process vocabulary only goes down-and-left cannot represent it.

**Sensible cooling has a practical limit at roughly 85% RH.** Beyond that, condensation begins
and the process is no longer sensible-only. The engine flags this rather than extrapolating a
horizontal line into the saturation curve.

### 4.2 Coils and heat-transfer devices
*   **Cooling coil (chilled water or DX)** — apparatus dew point and bypass factor, in all
    three equivalent forms so results check against any textbook:
    `BF = (t_lvg − t_adp)/(t_ent − t_adp) = (W_lvg − W_adp)/(W_ent − W_adp) = (h_lvg − h_adp)/(h_ent − h_adp)`.
    Coil SHR `= c_p,ma·(t_ent − t_lvg)/(h_ent − h_lvg)`. Total load
    `q = ṁ_da·(h_ent − h_lvg) − ṁ_cond·h_f,cond`; the condensate term is small but must not be
    silently dropped. DX coils additionally carry an anti-ice limit on leaving air temperature.
*   **Heating coil** (hot water, steam, electric), **preheat**, **reheat** — sensible,
    `q = ṁ_da·c_p,ma·Δt`.
*   **Face-and-bypass coil** — the airstream splits, one part reaching the coil condition and
    one bypassing unchanged, then the two mix adiabatically. Capacity is modulated by damper
    position rather than water flow, so `BF = ṁ_bypass/ṁ_total` is a *control* variable here,
    not just a coil characteristic.
*   **Heat-pipe wrap-around** — three vectors in sequence: sensible precool (`W` constant),
    cooling with dehumidification, then sensible reheat (`W` constant) using the recovered
    heat. It raises latent capacity and provides reheat with no new energy, which is why it
    displaces the "new energy" reheat that many codes restrict.
*   **Recuperative run-around with cooling** — the same idea using coupled water/glycol coils.

### 4.3 Humidification
*   **Steam / isothermal** — a near-vertical line at constant `t_db`. The latent heat was
    supplied in the boiler, so this is closer to mixing two gases than to heating air.
    `ṁ_steam = ṁ_da·(W_out − W_in)`, with process slope `Δh/ΔW = h_g` of the injected steam.
*   **Evaporative / adiabatic** — wetted rigid media, atomising spray, high-pressure fog, or an
    air washer. Follows constant `t_wb` up and to the left.
    Saturation effectiveness `ε = (t_in − t_out)/(t_in − t_wb,in)`.
    Typical values: air washer with opposed spray banks 95–98%; 300 mm rigid media 88–91%;
    residential aspen or mesh media 50–60%.

### 4.4 Dehumidification
*   **Cooling coil** — as §4.2.
*   **Solid desiccant wheel (active)** — sorbs vapour, releasing its latent heat as sensible
    heat: the process runs down and to the right at roughly constant enthalpy.
    `ṁ_water = ṁ_da·(W_in − W_out)`, latent effectiveness `ε_L = (W_in − W_out)/(W_in − W_eq)`.
    Requires a regeneration airstream at elevated temperature.
*   **Liquid desiccant** — same chart behaviour; the equilibrium humidity ratio is set by
    solution concentration and temperature rather than by a wheel position.
*   **Heat-pipe wrap-around** and **condensate reheat** — as §4.2.

### 4.5 Air-to-air energy recovery

All follow ASHRAE Standard 84: `ε = actual transfer ÷ maximum possible transfer`.
Sensible `ε_s = (t_1 − t_2)/(t_1 − t_3)`, total `ε_t` on enthalpy, latent on `W`.
Two parameters that a credible tool must not omit: **EATR** (exhaust air transfer ratio, the
cross-contamination fraction) and **OACF** (outdoor air correction factor).

| Device | Sensible ε | Latent ε | EATR | Chart behaviour |
|---|---|---|---|---|
| Fixed plate | 50–80% | 0 | 0–5% | Horizontal, `W` constant |
| Membrane plate | 50–75% | 50–73% | 0–5% | Diagonal toward other stream |
| Energy (enthalpy) wheel | 50–85% | 50–85% | 0.5–10% | Straight line toward other stream's state |
| Heat wheel (sensible) | 50–85% | 0 | 0.5–10% | Horizontal |
| Heat pipe | 45–65% | 0 | 0–1% | Horizontal |
| Run-around coil loop | 55–65% | 0 | 0 | Horizontal |
| Thermosiphon | 40–60% | 0 | 0 | Horizontal |
| Twin towers | 40–60% | yes | 0 | Diagonal |

For an enthalpy wheel with equal sensible and latent effectiveness, the supply-air process
vector runs in a straight line from the supply state toward the exhaust state, and its length
relative to the full separation *is* the effectiveness. That is a directly drawable construction
and belongs in teaching mode.

### 4.6 Evaporative cooling
*   **Direct (DEC)** — constant `t_wb`, `ε_e = (t_1 − t_2)/(t_1 − t'_s)`.
*   **Indirect (IEC)** — primary air is cooled sensibly at constant `W` while secondary air is
    evaporatively cooled. Wet-bulb depression efficiency
    `WBDE = (t_pri,in − t_pri,out)/(t_pri,in − t_wb,sec,in)`, typically 60–80%.
*   **Indirect/direct two-stage** — sensible precool lowers the entering wet-bulb, so the
    following direct stage reaches a lower dry-bulb than direct cooling alone. 40–50% energy
    saving in moderate-humidity zones.

### 4.7 Airside components
*   **Mixing box** — adiabatic mixing on a dry-air mass basis.
    `W_mix = (ṁ₁W₁ + ṁ₂W₂)/ṁ_mix`, `h_mix` likewise. The volumetric approximation for `t_mix`
    carries <1% error and is offered only as a labelled approximation. Includes "Winter V"
    mixing where the mix line crosses saturation and condensation occurs.
*   **Fan** — a real sensible heating process from motor and shaft work; not zero.
*   **Airside economizer** — dry-bulb or enthalpy changeover, reporting operating hours against
    imported weather data.
*   **Filters, dampers, sound attenuators, plenums** — **no psychrometric process**. They are
    modelled for pressure drop and for the layout diagram only, and must not appear as a
    process vector. A plenum may still carry a heat gain, which is a sensible process.

### 4.8 Terminal units
*   **VAV box** (with or without reheat), **fan-powered box** (series and parallel),
    **induction unit**, **active and passive chilled beam**, **fan coil unit**,
    **radiant panel**.
*   **DOAS (dedicated outdoor air system)** — conditions ventilation air separately from
    recirculated air, which **separates the sensible and latent loads** and is the reason it
    pairs with terminal units that handle sensible load only (chilled beams, radiant panels,
    fan coils, VRF). A tool that assumes one coil serves both loads cannot represent a DOAS.
*   Chilled beams and radiant panels are **sensible-only** devices: they must never be given a
    latent capacity, and a design that relies on them requires the dew point to be controlled
    upstream or condensation results.

### 4.9 Design derivation
*   **Room sensible heat ratio** `RSHF = q_s,room / q_t,room`, drawn as the room condition line
    through the room design state.
*   **Supply airflow** `ṁ_da = q_s,room / (c_p,ma·(t_room − t_SA))`, `V̇ = ṁ_da·v_SA`.
    Supply temperature difference typically 10–14 K.
*   **Automated cycle macros** — primary and secondary return-air cycles computed and plotted
    in one action, reporting sensible/latent/total load and moisture rates.
*   **SHR and Δh/ΔW protractor** for parallel reference lines; the scales relate by
    `Δh/ΔW = 2499.86/(1 − SHR)`.

## 5. Climatic Data & Standards Integration

*   **Bring-Your-Own-Data (BYOD):** drag-and-drop `.epw` (EnergyPlus) or CSV weather files,
    parsed and processed entirely client-side. Hosting global weather data is not viable for
    an open-source project, and local processing also keeps project data private.
*   **Data binning:** client-side WASM statistical binning (0.5 to 6 degree increments) of
    8760-hour data, rendered as a density heatmap.
*   **Bin analysis against envelopes:** hours inside/outside a selected envelope, and
    economizer / evaporative / mechanical-cooling hour counts.
*   **Standards overlays:**
    *   **ASHRAE Standard 55** comfort zones (2017/2020).
    *   **ASHRAE TC 9.9 datacenter envelopes**, with the published values:
        *   *Recommended:* 18–27 °C dry-bulb, dew point **−9 °C to +15 °C**, **≤60% RH**.
        *   *Allowable A1:* 15–32 °C, 20–80% RH, max DP 17 °C.
        *   *Allowable A2:* 10–35 °C, 20–80% RH, max DP 21 °C.
        *   *Allowable A3:* 5–40 °C, 8–85% RH, max DP 24 °C.
        *   *Allowable A4:* 5–45 °C, 8–90% RH, max DP 24 °C.
    *   Envelopes are **data files, not code**, so contributors can add one without touching
        TypeScript.

## 6. UI/UX & Layout Specs
*   **Top Navigation (48px):** Global controls for Project Management (Save/Load/Export), Unit Toggle, Elevation Input, Theme Toggle.
*   **Left Sidebar / Toolbox (64px):** Interactive tools (Select, Add State Point, Draw Process Line, Draw Shape, Crosshair Mode).
*   **Main Viewport:** Infinite panning and zoom-window controls for the primary canvas.
*   **Right Sidebar / Properties (320px):** Exact thermodynamic data. Supports both "Click on chart to set point" and "Manual numeric entry".
*   **Typography:** Monospaced fonts (JetBrains Mono/Fira Code) for numerical data readouts; Sans-serif (Inter/Roboto) for standard UI text.

## 7. Canvas Layering Hierarchy (Z-Index Pipeline)
*   **Layer 0 (Base Grid):** Cached skeleton of constant property curves.
*   **Layer 1 (Data Zones):** Semi-transparent SVG/Canvas polygons (Comfort/Datacenter zones).
*   **Layer 2 (Weather Binning):** Dense scatter plot or heatmap of hourly weather data.
*   **Layer 3 (Active Elements):** Interactive state points, directional process lines, text annotations.
*   **Layer 4 (HUD):** Dynamic crosshair snapped to grid with floating real-time property tooltip.

## 8. Customization & Theming
*   **Line Styling Matrix:** Dedicated UI modal to set Color, Line Style (Solid, Dotted, Dashed), and Width for *each* independent property family.
*   **Legend:** optional, toggled in Chart Options. Placement defaults to **Automatic**, which
    scores candidate rectangles against everything already drawn — curves, zones, weather bins,
    points — and places the legend in the emptiest region, re-evaluating on zoom, pan and layer
    toggle. Manual corner placement remains available.
*   **CSS Variable Theming:** Deep structural reliance on CSS variables. This allows users who fork the open-source repo to instantly apply their own branding/colors via a single `theme.css` file without touching the React code.
*   **Internationalization (i18n):** JSON-based localization system to encourage the open-source community to contribute translations for the UI and reports.

## 9. Export, Import & Data Exchange
*   **Vector Export:** Direct SVG and DXF file generation for crisp CAD and documentation insertion.
*   **Reporting:** Auto-generated PDF state point and process reports combining the chart, flow diagram, and tabular data.
*   **Data Export/Import:** CSV/Excel output for points/processes.
*   **Local File Access:** Utilize the File System Access API to save/load `.psy` or `.json` project files directly to local machines, ensuring complete data privacy for users.

---

## 10. Industry Profiles

One engine, three design contexts. A profile preselects the envelopes, default states,
process palette and report template; it never changes the thermodynamics.

### 10.1 Building HVAC
*   **Objective:** occupant comfort (Std 55), ventilation (Std 62.1), energy (Std 90.1).
*   **Typical SHR:** 0.65–0.85.
*   **Workflow:** room loads → RSHF line → supply airflow → mixing → coil selection.
*   **Needs:** minimum outdoor air `V̇_bz = R_p·P_z + R_a·A_z`; return-air plenum heat pickup
    (a large share of lighting gain and roof conduction is intercepted by return air, so
    `t_RA > t_room` at the mixing box); coil face velocity 2.0–2.5 m/s and leaving RH 85–95%
    as selection sanity checks; part-load behaviour, where room RH drifts as RSHF falls.

### 10.2 Automotive cabin A/C
*   **Objective:** transient comfort in a 2.5–3.5 m³ cabin under 850–1000 W/m² solar load,
    peaking at 4–6 kW.
*   **Typical SHR:** 0.5–0.75.
*   **What differs from buildings:** the design case is *transient*, not steady-state — pull-down
    from a 50–60 °C soak to 22 °C in 10–15 minutes; recirculation fraction is a control
    variable, not a fixed ratio; compressor and condenser airflow vary with engine/vehicle speed.
*   **Fogging is a psychrometric constraint, and the tool must check it:** fog forms when
    `t_dp,cabin ≥ t_glass,inner`. Defog forces the compressor on to dehumidify, then reheats —
    which is why a cabin model needs the sub-freezing branch of the engine.
*   **Needs:** cabin heat balance `Q = Q_solar + Q_envelope + Q_occ,sens + Q_occ,lat + Q_leak`,
    with ~70–100 W sensible and 40–70 g/h moisture per occupant; recirculation moisture
    build-up; evaporator anti-ice limit (leaving air above 1–3 °C).

### 10.3 Data centre cooling
*   **Objective:** IT availability and PUE.
*   **Typical SHR:** 0.95–1.0 — essentially all sensible, so process lines are **horizontal**
    (`W` constant). A tool that assumes a comfort-range SHR will mislead here.
*   **Why the humidity limits exist** (state them in the UI, not just the numbers): the upper
    dew-point bound guards against condensation on cold heat sinks and against corrosion and
    conductive anodic filament growth; the lower bound guards against electrostatic discharge.
*   **Needs:** TC 9.9 recommended and allowable A1–A4 overlays (§5); 8760-hour bin analysis for
    economizer and evaporative free-cooling hours; indirect evaporative cooling with
    wet-bulb depression effectiveness `(t_pri,in − t_pri,out)/(t_pri,in − t_wb,sec,in)`,
    typically 60–80%; hot/cold aisle ΔT of 10–20 K.

---

## 11. Teaching Mode

The second half of the product's purpose. These are requirements, not nice-to-haves.

*   **Show the working.** Any computed property can be expanded to reveal the equation used,
    the substituted values, and the reference it comes from.
*   **Name the trap.** Where a quantity is commonly confused with another (§3.2), the UI shows
    both side by side rather than silently picking one.
*   **Ideal-gas toggle.** Switching off the enhancement factor shows students the size of the
    real-gas correction instead of hiding it.
*   **Process animation.** Stepping along a process line updates every property live, so the
    relationship between the chart geometry and the numbers is visible rather than asserted.
*   **Worked examples** shipped as loadable project files, traceable to their textbook source.

---

## 12. Verification and Provenance

*   A **conformance test suite** pins the engine against published ASHRAE/IAPWS reference
    values, including the sub-freezing region, altitude cases and the constants in §3.1. It is
    the acceptance criterion for any change to the calculation layer, and it stays valid
    whichever library performs the arithmetic.
*   **Every number is traceable.** Reports cite the formulation and standard edition used.
*   **No silent unit or basis conversion.** Dry-air basis is stated on every extensive quantity.
