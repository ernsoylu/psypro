/**
 * Where the blocks sit on the schematic, and the blocks that are not processes.
 *
 * Position is **presentation, not physics**, so it is kept out of `Process`.
 * Putting an `x` and a `y` on a cooling coil would make the object that
 * describes a coil depend on where somebody dragged it, and every consumer of
 * that object — the resolver, the exporters, the conformance tests — would carry
 * two fields it has no use for. `useStyleStore` set this precedent and it holds
 * here for the same reason.
 *
 * It also means a document with no schematic still opens: nothing here is
 * required, and anything missing is laid out automatically.
 *
 * # The nodes that are not processes
 *
 * `REQUIREMENTS.md` §4.7 is explicit that filters, dampers, sound attenuators
 * and plenums have **no psychrometric process** and must not appear as a process
 * vector. A designer still wants them on the diagram. So they live here, as
 * *pass-through* nodes: drawn, labelled, sitting on a wire, and leaving the air
 * exactly as it arrived. Keeping them out of the process store is not tidiness —
 * it is the only way to draw a filter without also drawing a line on the chart
 * that claims it did something.
 */

import { create } from 'zustand';

import { producerOf, tearOf, type StatePoint } from './usePsychStore';
import type { Process } from './useProcessStore';

/** A point on the schematic canvas. */
export interface Position {
  x: number;
  y: number;
}

/** A block that is drawn but conditions nothing. */
export interface PassThrough {
  /** Stable identity. */
  id: string;
  /** Which kind of nothing it does. */
  kind: PassThroughKind;
  /** The wire it sits on — the point whose stream it interrupts. */
  onPointId: string;
  /** A name the user can change, e.g. "MERV 13". */
  label: string;
}

/** The §4.7 components that are drawn but carry no process. */
export type PassThroughKind = 'filter' | 'damper' | 'attenuator' | 'plenum';

/** What the schematic store holds. */
export interface SchematicState {
  /** Where each block sits, by process id, point id, or pass-through id. */
  positions: Record<string, Position>;
  /** The drawn-but-inert blocks of §4.7. */
  passThroughs: PassThrough[];

  /** Moves a block. */
  setPosition: (id: string, position: Position) => void;
  /** Moves several at once, for a drag that carries a selection. */
  setPositions: (positions: Record<string, Position>) => void;
  /** Adds a pass-through block onto a wire. */
  addPassThrough: (kind: PassThroughKind, onPointId: string, label: string) => string;
  /** Removes one. */
  removePassThrough: (id: string) => void;
  /** Renames one. */
  renamePassThrough: (id: string, label: string) => void;
  /** Forgets a block's position, for when the block goes away. */
  forget: (id: string) => void;
  /** Replaces everything, for file open and for tests. */
  replaceAll: (state: Pick<SchematicState, 'positions' | 'passThroughs'>) => void;
}

let counter = 0;

/** The prefix every generated pass-through id carries. */
const ID_PREFIX = 'pt-through-';

export const useSchematicStore = create<SchematicState>((set) => ({
  positions: {},
  passThroughs: [],

  setPosition: (id, position) =>
    set((s) => ({ positions: { ...s.positions, [id]: position } })),

  setPositions: (positions) =>
    set((s) => ({ positions: { ...s.positions, ...positions } })),

  addPassThrough: (kind, onPointId, label) => {
    counter += 1;
    const id = `${ID_PREFIX}${counter}`;
    set((s) => ({ passThroughs: [...s.passThroughs, { id, kind, onPointId, label }] }));
    return id;
  },

  removePassThrough: (id) =>
    set((s) => ({
      passThroughs: s.passThroughs.filter((p) => p.id !== id),
      positions: Object.fromEntries(
        Object.entries(s.positions).filter(([key]) => key !== id),
      ),
    })),

  renamePassThrough: (id, label) =>
    set((s) => ({
      passThroughs: s.passThroughs.map((p) => (p.id === id ? { ...p, label } : p)),
    })),

  forget: (id) =>
    set((s) => ({
      positions: Object.fromEntries(
        Object.entries(s.positions).filter(([key]) => key !== id),
      ),
    })),

  replaceAll: ({ positions, passThroughs }) => {
    for (const p of passThroughs) {
      if (!p.id.startsWith(ID_PREFIX)) continue;
      const n = Number(p.id.slice(ID_PREFIX.length));
      if (Number.isInteger(n) && n > counter) counter = n;
    }
    set({ positions, passThroughs });
  },
}));

/** Resets the id counter. Test-only. */
export function resetPassThroughIdCounter(): void {
  counter = 0;
}

/** Horizontal distance between one layer of the circuit and the next. */
export const COLUMN = 260;

/** Vertical distance between two blocks sharing a layer. */
export const ROW = 130;

/**
 * A schematic node: a block on the canvas, and what it stands for.
 *
 * Three kinds, and the distinction is the mapping the whole designer rests on:
 * a **process** is equipment, a **boundary** is where air enters or leaves the
 * drawing, and a **pass-through** is drawn but inert.
 */
export type SchematicNode =
  | { kind: 'process'; id: string; process: Process }
  | { kind: 'boundary'; id: string; point: StatePoint; role: 'source' | 'terminal' }
  | { kind: 'passThrough'; id: string; block: PassThrough };

/**
 * Works out which blocks a document has, and where to put the ones nobody has
 * placed.
 *
 * This is what makes the two views genuinely interchangeable rather than
 * nominally so. A document built entirely on the chart has no positions at all;
 * without a layout it would open on the Design page as a heap at the origin, and
 * "bidirectional" would mean "you may edit either view, but only one of them is
 * readable".
 *
 * The layering is longest-path: a block sits one column to the right of the
 * furthest-left thing that feeds it, which puts air flow left to right and keeps
 * a mixing box downstream of *both* its inlets rather than of whichever was
 * declared first. Siblings in a column stack vertically in document order.
 *
 * **Tear edges are excluded from the walk**, and have to be: a tear exists
 * precisely because following that edge never terminates. The wire is still
 * drawn — the user has to see the circuit — it just does not decide where
 * anything sits.
 */
export function layoutDocument(
  points: readonly StatePoint[],
  processes: readonly Process[],
  passThroughs: readonly PassThrough[],
  stored: Record<string, Position>,
): { nodes: SchematicNode[]; positions: Record<string, Position> } {
  const consumed = new Set<string>();
  for (const process of processes) {
    consumed.add(process.fromId);
    if (process.secondId) consumed.add(process.secondId);
  }
  const produced = new Map<string, string>();
  for (const process of processes) {
    for (const outletId of [process.toId, process.toSecondId]) {
      if (outletId) produced.set(outletId, process.id);
    }
  }

  const nodes: SchematicNode[] = [];
  for (const point of points) {
    // A point in the middle of a train is a *wire*, not a block: it is drawn as
    // the line between two pieces of equipment. Only the ends of the drawing
    // get a block of their own — where air comes from, and where it goes.
    const isSource = producerOf(point) === null && consumed.has(point.id);
    const isTerminal = !consumed.has(point.id);
    if (isSource || isTerminal) {
      nodes.push({
        kind: 'boundary',
        id: point.id,
        point,
        role: isSource ? 'source' : 'terminal',
      });
    }
  }
  for (const process of processes) {
    nodes.push({ kind: 'process', id: process.id, process });
  }
  for (const block of passThroughs) {
    // A pass-through whose wire has been deleted is not on the diagram any
    // more. Dropping it here rather than erroring keeps a hand-edited file
    // openable.
    if (points.some((p) => p.id === block.onPointId)) {
      nodes.push({ kind: 'passThrough', id: block.id, block });
    }
  }

  // Longest-path depth, computed by relaxation. A pass over the processes that
  // moves nothing means every depth is settled; the loop is bounded by the node
  // count because each pass advances at least one node in an acyclic graph, and
  // the tear exclusion is what guarantees it is acyclic.
  const depth = new Map<string, number>();
  for (const node of nodes) {
    if (node.kind === 'boundary' && node.role === 'source') depth.set(node.id, 0);
  }
  /**
   * The column a *wire* leaves from: its producer's, or zero at a boundary.
   *
   * A wire does not occupy a column of its own — it is the line between two
   * blocks — so this answers where the block feeding it sits, and the consuming
   * process goes one further right.
   */
  const pointDepth = (pointId: string): number | null => {
    const producer = produced.get(pointId);
    if (producer === undefined) return depth.get(pointId) ?? 0;
    return depth.get(producer) ?? null;
  };

  for (let pass = 0; pass < nodes.length + 1; pass += 1) {
    let moved = false;
    for (const process of processes) {
      const inlets = [process.fromId, process.secondId].filter(
        (id): id is string => id !== null,
      );
      let deepest = 0;
      let ready = true;
      for (const inletId of inlets) {
        const point = points.find((p) => p.id === inletId);
        // A tear is a specified stream, so it starts a walk rather than
        // continuing one. Following it is what would never terminate.
        if (point && tearOf(point) !== null) continue;
        const d = pointDepth(inletId);
        if (d === null) {
          ready = false;
          break;
        }
        deepest = Math.max(deepest, d);
      }
      if (!ready) continue;
      // One column past the furthest-left thing that feeds it.
      const column = deepest + 1;
      if (depth.get(process.id) !== column) {
        depth.set(process.id, column);
        moved = true;
      }
    }
    if (!moved) break;
  }

  // Terminals sit one column past whatever produced them.
  for (const node of nodes) {
    if (node.kind !== 'boundary' || node.role !== 'terminal') continue;
    const producer = produced.get(node.id);
    depth.set(node.id, producer === undefined ? 0 : (depth.get(producer) ?? 0) + 1);
  }

  // A pass-through sits on the wire it interrupts, so it takes its column from
  // whatever produced that point — half a column along, so it reads as being on
  // the line rather than as another piece of equipment in the chain.
  const passThroughOffset = new Map<string, number>();
  for (const node of nodes) {
    if (node.kind !== 'passThrough') continue;
    const producer = produced.get(node.block.onPointId);
    depth.set(node.id, producer === undefined ? 0 : (depth.get(producer) ?? 0));
    passThroughOffset.set(node.id, COLUMN / 2);
  }

  const positions: Record<string, Position> = {};
  const filled = new Map<number, number>();
  for (const node of nodes) {
    if (stored[node.id]) {
      positions[node.id] = stored[node.id]!;
      continue;
    }
    const column = depth.get(node.id) ?? 0;
    const row = filled.get(column) ?? 0;
    filled.set(column, row + 1);
    positions[node.id] = {
      x: column * COLUMN + (passThroughOffset.get(node.id) ?? 0),
      y: row * ROW,
    };
  }

  return { nodes, positions };
}
