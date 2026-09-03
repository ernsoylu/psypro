# Plan — the schematic designer, and the circuit it has to draw

Status: **proposal.** Branch `claude/psypro-state-points-processes-n8mves`.

The Process Design page draws seven fixed blocks in a row and greys out the ones the macro does
not run. It is a picture of *one* cycle. What is wanted is an editor: drag blocks out, wire them
together, build an arbitrary air-handling circuit — and have it be the same document the chart is
showing, edited from either side.

---

## 1. The mapping, which is the whole design

A schematic and a psychrometric chart look nothing alike and are the same graph:

| Chart | Schematic |
|---|---|
| A **process** — the vector from one state to another | A **block** — the equipment that moves the air |
| A **point** — a state | A **wire** — the duct between two blocks, carrying that state |
| `A.toId === B.fromId` | a wire runs from block A into block B |

So the schematic needs **no new document model**. It is a second view of `usePsychStore` +
`useProcessStore`, and bidirectional editing is not a synchronisation problem — there is only one
document, and both views are projections of it. Any design that gives the schematic its own
node model has to keep two graphs in step, and that is the failure this mapping avoids.

What the schematic genuinely adds is **position**, and position is presentation rather than
physics — so it goes in its own store, not onto `Process`. `useStyleStore` sets the precedent.

## 2. What a circuit needs that the model cannot yet express

### 2.1 A recirculating circuit is a loop, and the resolver requires a DAG

`OA + RA → mix → coil → fan → room → RA` is a cycle: the mixing box consumes return air, and
return air is produced by the room, which is fed from the mixing box. The document resolver
reports a cycle as an error, correctly — it resolves in one pass and a loop has no starting
point.

The answer is not a simultaneous solver. It is the one sequential-modular flowsheet solvers have
used for fifty years: a **tear stream**. One stream in the loop is *specified* rather than
computed, the loop is cut there, and everything else resolves in order.

In HVAC that stream is already the natural one: **the room condition is a design input**. You
state the room at 24 °C / 50% and the load it carries; you do not compute it. So the return-air
point is a typed point, the loop is torn there, and the graph stays acyclic.

The schematic still **draws** the return wire — the user has to see the circuit — marked as a
tear so it reads as "this stream is specified, not computed". Drawing a connection that closes a
loop offers to make it one.

This is the load-bearing idea in the whole plan. Without it, either the circuit cannot be drawn
or the resolver has to become an iterative solver.

### 2.2 Three kinds of node the document has no word for

* **A source.** Outdoor air is a typed point with no producer. It is already expressible; it just
  needs to *render* as a block rather than as a bare wire end.
* **A load.** A room is `supply air in, return air out, q_sensible and q_latent applied` — a
  process, and the one missing from the palette. It is what closes a circuit and what makes the
  Design page's macro expressible as an ordinary document rather than a special case.
* **A split.** Relief and recirculation leave a return plenum at a flow ratio; both streams carry
  the *same state*. `Process` has one `toId`, so this needs a second outlet — the only change to
  the process shape in this plan.

### 2.3 Blocks that are not processes

`REQUIREMENTS.md` §4.7 is explicit: filters, dampers, sound attenuators and plenums have **no
psychrometric process** and must not appear as a process vector. A designer still wants them on
the diagram. So the schematic carries **pass-through nodes**: they sit on a wire, they are drawn,
they are labelled, and the state leaves them exactly as it arrived. They live in the schematic
store, not in the process store, which is precisely what §4.7 asks for.

## 3. The build

### A. The document model catches up

* `load` process kind: inlet, `qSensible`, `qLatent`, `mdot` → outlet. The room, and the block
  that closes a circuit.
* `split` process kind, and `toSecondId` on `Process`: one inlet, two outlets at a flow ratio,
  both at the inlet's state.
* **Tear points.** A typed point that is *also* wired as a process's downstream: it carries a
  `tearOf` marker naming the process whose outlet it stands in for. The resolver ignores the
  edge, so the graph stays acyclic; the schematic draws it; the panel reports the *mismatch*
  between the specified state and what the upstream process actually produced, which is the
  convergence error a flowsheet would iterate away and here is a number the designer reads.

### B. The schematic store

`useSchematicStore`: a position per block, the pass-through nodes, and the canvas viewport.
Serialised under its own key in the project file (format 3), separate from the physics, so a
document without one still opens — and gets laid out automatically.

**Auto-layout** by a layered walk of the DAG: longest-path layering left to right, siblings
stacked. This is what makes the two views genuinely interchangeable rather than nominally so — a
document built entirely on the chart opens on the Design page as a readable circuit, with no
placement work.

### C. The canvas

HTML blocks absolutely positioned inside a pan/zoom viewport, with SVG for the wires. The
existing page already chose HTML over canvas for the schematic and gave the reason — a schematic
is boxes with text in them, and the browser lays those out, makes them selectable, and reads them
to a screen reader. That reasoning holds harder for an editor than for a static strip.

* Drag from the palette onto the canvas to add a block.
* Drag a block to move it; drag from an outlet port to an inlet port to wire it.
* Deleting a block is the document action that already exists.

### D. Bidirectional, which is mostly free

Selection and parameters are already in the stores, so both views read and write the same thing.
What has to be built is the *correspondence*: selecting a block selects its process, which
highlights its vector on the chart, and the reverse. The chart and the schematic can then be
shown side by side and stay in step because there is nothing to keep in step.

## 4. Order

| Step | Contents |
|---|---|
| A | `load` and `split` kinds, `toSecondId`, tear points, resolver and tests |
| B | `useSchematicStore`, auto-layout, format 3 |
| C | The canvas: blocks, wires, ports, palette, pan and zoom |
| D | Selection correspondence both ways; the Design page rebuilt around it |

A is answer-independent and lands first. The macro's cycle then becomes an ordinary document that
the schematic draws, which retires the special case rather than adding a second one beside it.

## 5. Open questions

1. **Hand-roll the node canvas, or take `@xyflow/react`?** It is MIT and would save perhaps 400
   lines, at the cost of ~100 kB and a component model that wants to own the graph — which is
   exactly the thing this plan says the document already owns.
2. **What happens to the eight-field design case?** It can stay as a "start a circuit from a load"
   form that materialises a circuit, or be retired now that the circuit is directly editable.
3. **How much palette in the first landing** — the airside train, or the terminal units of §4.8
   as well?
