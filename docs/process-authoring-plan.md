# Plan — state points, processes, and the real-world coil

Status: **implemented**, in four commits on `claude/psypro-state-points-processes-n8mves`.
Sections 1 and 2 are kept as written — the analysis of what was wrong and the design that
answers it — with an implementation note against each step. Section 5 records the decisions
taken, including one correction the tests forced.

This plan answers four complaints, all of which are the same complaint seen from different
sides: *the document is a bag of points with some arrows drawn near them, rather than an air
system.*

1. Adding a point and adding a process are unrelated gestures, and neither is discoverable.
2. A process cannot create its own endpoint, so a train of processes cannot be built at all.
3. Two existing points cannot be joined into a process that says what it is and what it costs.
4. Sensible cooling below the entering dew point returns an engine error instead of doing what
   a coil does — condensing water out and running down toward the apparatus dew point.

---

## 1. What is actually wrong today

### 1.1 A process outlet is not a point, so nothing chains

`Process` holds `fromId` and derives its outlet (`useResolvedProcesses`). The outlet exists
only as an arrowhead. There is no id for it, so it cannot be the `fromId` of the next process.

The consequence is the whole complaint: **OA → mix → coil → fan → room cannot be drawn.** To
get the second process you have to read the first one's outlet off the panel, type it back in
as a new point by hand, and then keep the two in step yourself for the rest of the session.
The moment the elevation, the unit system or the inlet moves, the hand-typed point is a lie
and nothing in the tool says so.

That is also why `useResolvedProcesses` can resolve each process independently today: nothing
depends on anything. The fix necessarily ends that, and it is the largest single change here.

### 1.2 The `drawProcess` tool does nothing

`Toolbox` offers five tools. `App` wires exactly one of them — `addPoint` sets `placing`.
Selecting *Draw process line* changes the cursor's meaning not at all, which is worse than not
offering it. The gesture a user expects (click a point, drag to a second point) is the most
direct expression of "a process joins two states", and it is the one gesture missing.

### 1.3 Adding a process guesses its inlet, silently

```tsx
onAdd={(kind) => {
  const from = selected ?? psych.points[0];   // App.tsx
  if (from) proc.addProcess(defaultProcess(kind, from.id));
}}
```

The inlet is whatever happened to be selected — or, if nothing is, the first point in creation
order. The panel then shows no *from* field at all, only `secondId`, so the one binding the
user cannot see is the one that was guessed for them.

`defaultProcess` compounds it: `targetT: 30`, `targetW: 0.012`, `duty: 10` are constants in SI,
applied to an IP document unconverted and without reference to the inlet. Adding a sensible
process to a 35 °C outdoor point produces "cool to 30 °C"; adding the same process in IP
produces "cool to 30 °F".

### 1.4 The "between two points" case is a stub

`link` draws a straight line and reports the load. It does not say *what kind of process* the
line is, does not back out the parameters that define it (effectiveness, bypass factor, steam
enthalpy), and cannot be turned into a parametric process afterwards. So the answer to "I have
two points, give me the process between them" is currently "here is a load and an arrow".

### 1.5 Sensible cooling into the saturation curve is refused, not modelled

`process::sensible_to` holds `W` and calls `StatePoint::from_db_w(t_out, inlet.w, atm)`. Below
the entering dew point that pair is above saturation, so `from_db_w` refuses it:

> state lies above saturation at 10.00 °C: W = 0.010 against W_s = 0.008; the fog region is not
> yet modelled

The user sees a red error where a real coil would be making condensate. The physics is not
hard and this repository already has it — `coil::from_leaving` and `coil::from_adp` construct
the apparatus dew point, the three bypass factors, the coil SHR and the condensate — but that
construction is reachable only from the Process Design page's macro, never from a process a
user draws.

Note the same gap in the palette: `ProcessKind` has no **cooling with dehumidification** and no
**desiccant dehumidification**, which are two of the ten vectors in `REQUIREMENTS.md` §4.1 and
between them cover most of what a designer draws. The engine can do both; the document model
cannot express either.

### 1.6 The Process Design page is an island

`useCycleStore` holds eight numbers. `App` solves the cycle from them and `ProcessDesignPage`
renders the result. Nothing crosses in either direction: the cycle's OA/MA/CL/SA states never
become points, the chart never draws them, the document's points cannot be adopted as the
design case, and the schematic blocks are not bound to process objects — which Phase 8's own
exit criteria said they would be.

---

## 2. The design

Four changes, in dependency order. Each is useful on its own and each is separately testable.

### A. The engine learns the wet coil, the desiccant, and how to identify a process

All in `crates/psychro-core`, exposed through `psychro-wasm`. No TypeScript arithmetic, per
`CLAUDE.md` §Architecture.

**A1 — `cool_to(inlet, t_target, bypass_factor, mdot_da, atm)`.** *(Implemented, with one
correction: the dry/wet branch is decided on the **surface**, not on the target temperature —
see the note under §5.)*

* `t_target ≥ t_dp,in` → dry coil. Horizontal, `W` held, exactly what `sensible_to` does now.
* `t_target < t_dp,in` → **wet coil**, and this is the fix. The leaving state lies on the line
  from the entering state to the apparatus dew point, at the bypass factor:

  ```text
  t_adp = (t_lvg − BF·t_ent)/(1 − BF)          [closed form: BF on temperature]
  W_adp = W_s(t_adp)
  W_lvg = W_adp + BF·(W_ent − W_adp)
  ṁ_cond = ṁ_da·(W_ent − W_lvg)
  ```

  No iteration: the temperature form of the bypass factor inverts directly, and the result is
  then handed to the existing `coil::from_leaving` so the ADP, the three BF forms, the coil
  SHR and the condensate-corrected load all come from the one construction already under test.
  `BF = 0` degenerates to saturated leaving air, which is the ideal-coil bound.

  The result carries `dehumidified: true` and the condensate, so a caller cannot show a wet
  coil as if it were a dry one.

  This *does* satisfy `REQUIREMENTS.md` §4.1's "flags rather than extrapolating a horizontal
  line into the saturation curve" — nothing is extrapolated horizontally; the process turns and
  follows the coil line, and the turn is reported. §4.1's wording gets a sentence added saying
  what happens after the flag.

**A2 — two new process kinds.** `cooling` (cooling with dehumidification, parametrised as ADP +
BF, straight onto `coil::from_adp`) and `desiccant` (the mirror of evaporative: down and to the
right at roughly constant enthalpy, `ε_L = (W_in − W_out)/(W_in − W_eq)`, per §4.4). Both close
gaps in §4.1's vocabulary that the engine can already service.

**A3 — `identify(inlet, outlet, mdot_da, atm) -> ProcessFit`.** Given two states, name the
process and back out its defining parameters:

| Test on the pair | Identified as | Parameters returned |
|---|---|---|
| `ΔW ≈ 0`, `Δt > 0` | sensible heating | duty, target `t` |
| `ΔW ≈ 0`, `Δt < 0` | sensible cooling (dry) | duty, target `t` |
| `Δt ≈ 0`, `ΔW > 0` | isothermal / steam | `ṁ_steam`, implied `h_steam = Δh/ΔW` |
| `Δt_wb ≈ 0`, `ΔW > 0` | evaporative | `ε = (t_in − t_out)/(t_in − t_wb,in)` |
| `ΔW < 0`, `Δh < 0` | cooling + dehumidification | ADP, three BFs, coil SHR, condensate |
| `ΔW < 0`, `Δt > 0` | desiccant | `ε_L`, moisture removed |
| anything else | general | load, SHR, `Δh/ΔW` |

This is classification against definitions, not a new formulation, so it belongs on the PsyPro
side of the boundary next to the load decomposition rather than upstream in frees. Tolerances
are relative and named constants, and the fit reports which test it matched so the UI can say
"identified as evaporative cooling (wet-bulb held to within 0.05 K)" rather than asserting it.

**Tests:** extend `tests/process_conformance.rs` with a wet-coil case worked from a textbook,
the `BF = 0` saturated bound, a dry/wet boundary case at exactly the dew point, a desiccant
case, and a round trip — build a process forward with known parameters, identify it backwards,
assert the parameters come back.

### B. Points gain a provenance, and the document becomes a graph

The rule that a point stores *inputs* rather than derived properties stays. What changes is
that a process outlet is admitted as a kind of input.

```ts
type PointSource =
  | { kind: 'input' }                          // anchored: dryBulb + mode + secondValue, as today
  | { kind: 'outlet'; processId: string };     // derived: positioned by the process that makes it
```

* Adding a process **creates its outlet point automatically**, labelled from the sequence
  (`OA → MA → CL → SA`, then `P4`…), selectable, drawn, exportable — and usable as the next
  process's `fromId`. That is the request, in one sentence.
* `Process` gains `toId`, so the graph is explicit rather than implied.
* A derived point's inputs are not editable in the panel; the panel shows the process that
  produces it and links to it. Dragging one is either refused with an explanation or inverted
  into the process's own parameter — see the open question below.
* Deleting a process deletes its outlet point unless another process consumes it, in which case
  the outlet is **converted to anchored** at its last resolved state, so the downstream train
  survives the edit rather than collapsing.

`useResolvedPoints` and `useResolvedProcesses` merge into one `useResolvedDocument`, because
they are now mutually dependent. It resolves anchored points first, then walks the processes in
topological order filling in derived outlets. A cycle (`A →proc→ B →proc→ A`) is detected and
reported on the offending processes rather than hanging the render. `mix` and `recovery` take
two inlets and one outlet, so the graph is a DAG with in-degree 1 or 2 — an ordinary topological
sort, not a solver.

Determinism matters here: the walk must be stable across renders and must not re-enter WASM for
a point that has already resolved this pass, or the 60 FPS drag path pays for the whole train
on every pointer move. Memoisation keys on the graph shape plus the document settings.

**File format v2.** Points carry `source`, processes carry `toId`. A v1 file loads with every
point anchored and each process's outlet **materialised on open**, which both migrates cleanly
and gives an old project the new behaviour for free. `FORMAT_VERSION` goes to 2; the existing
"a newer file is refused, not half-read" rule already covers the other direction.

### C. Authoring gestures that match how the work is described

**C1 — the process list.** The inspector gets a document outline above the point editor: points
and processes in flow order, showing the chain (`OA ──mix── MA ──cooling── CL`). Selecting a row
selects the object. Each point row carries a *continue from here* action, which is how a
process gets added from now on — never from a guessed selection.

**C2 — the draw-process tool becomes real.** With `drawProcess` active: press on a point, drag,
release on a second point → a fitted process between them (kind identified per A3, parameters
back-solved and shown). Release on empty chart → an anchored point is created there and the
same fit is made against it. Press on empty chart first → creates the start point. A rubber-band
line follows the pointer with a live `Δh / ΔW / SHR` readout, and the pointer snaps to a point
within ~12 px so a train joins up exactly rather than nearly.

**C3 — the `link` kind grows up.** It keeps its stored id (v1 files hold it) but is presented as
*Process between two points*, reports the identification and the back-solved parameters, and
offers **Convert to parametric** — which adopts those parameters as a real `sensible`,
`evaporative`, `cooling`… process and makes the second point that process's derived outlet.
That is the "assign a process between two points and have its data calculated" request, and the
conversion is what stops it being a dead end.

**C4 — a wet target stops being an error.** When a `sensible` process is given a target below
the entering dew point, the panel no longer shows the backend's supersaturation message. It
shows the wet result from A1 — leaving state, ADP, bypass factor, condensate — with a plain
explanation ("13.9 °C is below the entering dew point; the coil is wet and condenses
0.0031 kg/s") and a one-click **promote to cooling coil**, which exposes the ADP and BF fields.
The physics is right immediately; the store is not mutated behind the user's back.

**C5 — defaults derived from the inlet.** `defaultProcess` takes the resolved inlet and the unit
system: sensible targets `t_in + 10 K` (or −10 K when the inlet is warm enough to be a cooling
case), steam targets `W_in + 0.002`, cooling defaults to `BF = 0.1` and an ADP 2 K below the
achievable minimum. Every default lands somewhere physical on the first click, in the
document's own units.

### D. The Process Design page joins the document

* **Send cycle to chart** — the solved `CycleOutput` materialises as real points (OA, RA, MA,
  CL, SA) and real processes (mixing, cooling coil, supply fan), so the macro's answer becomes
  an editable document rather than a read-only strip. This is the single change that connects
  the two pages.
* **Adopt from point** — the outdoor and room design conditions can be bound to existing points
  instead of being retyped.
* **Bind the blocks** — clicking a schematic block selects the corresponding process or point,
  which is what Phase 8 said the blocks would do.

---

## 3. Order of work

| Step | Contents | State |
|---|---|---|
| A | Engine: `cool_to`, `cool_by_duty`, `cooling` + `desiccant`, `identify`, wasm bindings | **done** — 14 cases in `crates/psychro-core/tests/wet_cooling.rs` |
| B | Point provenance, document graph solver, format v2 + migration | **done** — 17 cases in `web/src/store/document.test.ts` |
| C | Outline, draw tool, fit-and-adopt, wet-target UI, derived defaults | **done** — snapping in `geometry.test.ts`, flow in `App.test.tsx` |
| D | Cycle → document | **done** — adopt-from-point and block binding stay deferred |

Two things the implementation added that the plan did not foresee:

* **`cool_by_duty`.** `sensible_duty` carried the same refusal as `sensible_to`, and fixing
  only the temperature form would have left the identical bug one field away. It turned out to
  be the *closed-form* half of the pair — the coil's balances interpolate enthalpy exactly, so
  the surface enthalpy inverts directly and nothing needs iterating.
* **A secant refinement on the apparatus dew point.** The plan's closed form places the ADP by
  the *temperature* form of the bypass factor, but a coil mixes its contacted and bypassed
  streams on mass and energy, so the `(W, h)` chord is the definition and interpolating
  temperature is the approximation. Without the refinement the bypass factor read back off the
  solved coil differs in the third decimal from the one typed in the field beside it, and a
  reader who spots that has no way to tell which of the two numbers is the lie.

A is worth landing on its own: it fixes the reported physics bug and adds two missing process
kinds without touching the document model. B is the structural change and carries the file
format. C and D are independent of each other once B lands.

## 4. What this does not change

* No TypeScript psychrometrics. Every number above still comes from a WASM call, including the
  identification and the back-solved parameters.
* Points still store inputs, never derived properties. A derived point stores *which process
  produces it*, which is an input of a different kind, not a cached result.
* The three-layer separation, the Z-index pipeline, the theming rule and the i18n rule are
  untouched. New strings go through `en.json`.
* frees stays the calculation backend. Nothing here needs an upstream change: the wet coil, the
  desiccant and the identification are all definitions and constructions on top of properties
  frees already provides.

## 5. Decisions taken

1. **Default bypass factor for a wet cooling process: `BF = 0.1`, visible and editable.** The
   decision stands; the reasoning behind it was backwards and the tests caught it. At a fixed
   *leaving temperature* — which is how a user states a coil — zero bypass means a **warmer**
   surface, so the air leaves saturated and the coil removes the **least** water, not the most.
   Zero therefore understates the dehumidification rather than overstating it. The intuition
   that less bypass means more water out holds only at a fixed apparatus dew point. Ten percent
   is right because it puts the leaving air near 90% RH, where coils are actually measured, and
   `no_bypass_leaves_saturated_air_and_the_least_condensate` pins the direction so the
   confusion cannot come back.

   A second correction from the same test run: **the dry/wet branch is decided on the surface
   the bypass factor implies, not on the target temperature.** Testing the target against the
   entering dew point puts a step in the condensate at the boundary; testing the surface makes
   it continuous, because at `t_adp = t_dp` the saturated surface humidity equals the entering
   humidity and the wet branch meets the dry one exactly. The residual left over is 1e-7 kg/s,
   which is the backend's own dew-point round trip; branching on the target instead steps by
   7e-4, three orders larger.
2. **Dragging a derived point inverts into the process parameter.** Dragging the outlet of a
   sensible process moves its target temperature; dragging an evaporative outlet moves its
   effectiveness. Kinds whose outlet is fixed by two parameters — mixing, recovery — refuse the
   drag and say which field to edit instead, because one position cannot recover two numbers.
3. **Step D is "send cycle to chart" only** in this pass. Adopt-from-point and block binding
   are deferred; the materialised cycle is the change that stops the page being an island.
