/**
 * The circuit editor: blocks you drag out, ports you wire together.
 *
 * Every node and every edge here is **derived from the document**, and every
 * gesture is turned back into a document edit. React Flow owns the interaction —
 * pan, zoom, ports, dragging, hit-testing — and owns no state: `nodes` and
 * `edges` are recomputed from `usePsychStore` and `useProcessStore` on each
 * render, so the schematic cannot drift from the chart because there is nothing
 * for it to drift *from*. It is the same graph.
 *
 * That is the whole architectural bet, and it is why the library is used in its
 * controlled mode. Letting React Flow hold the nodes would give the schematic a
 * second graph to keep in step with the first, which is the failure mode this
 * design exists to avoid.
 *
 * # What a block is, and what a wire is
 *
 * A **process is a block** — the equipment that moves the air. A **point is a
 * wire** — the duct between two blocks, carrying the state at that place in the
 * circuit. Only the ends of the drawing get a block of their own: where air
 * comes from, and where it goes.
 */

import { useCallback, useMemo } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';

import { BlockNode, type BlockNodeData } from './BlockNode';
import { useT } from '../i18n/useT';
import type { TranslationKey } from '../i18n';
import type { StatePointOutput } from '../psychro';
import { needsSecondPoint, type Process } from '../store/useProcessStore';
import { isTear, type StatePoint } from '../store/usePsychStore';
import {
  layoutDocument,
  type PassThrough,
  type Position,
  type SchematicNode,
} from '../store/useSchematicStore';
import type { ResolvedProcess } from '../store/useResolvedProcesses';
import type { ResolvedPoint } from '../store/useResolvedPoints';

/** The node types React Flow renders. One, because every block is one shape. */
const NODE_TYPES = { block: BlockNode };

/** What the canvas needs. */
export interface SchematicCanvasProps {
  points: StatePoint[];
  processes: Process[];
  passThroughs: PassThrough[];
  positions: Record<string, Position>;
  resolvedPoints: Map<string, ResolvedPoint>;
  resolvedProcesses: Map<string, ResolvedProcess>;
  /** The translated name of a process kind. */
  kindLabel: (process: Process) => string;
  /** Which block is selected, by process or point id. */
  selectedId: string | null;
  /** Whether the document is in SI, for the state summaries on the wires. */
  isSi: boolean;
  /** Selects a process. */
  onSelectProcess: (id: string) => void;
  /** Selects a point. */
  onSelectPoint: (id: string) => void;
  /** Commits a block's new position. */
  onMove: (positions: Record<string, Position>) => void;
  /** Wires one block's outlet into another block's inlet. */
  onConnect: (
    outletPointId: string,
    intoProcessId: string,
    slot: 'from' | 'second',
  ) => void;
  /** Deletes a block. */
  onDelete: (node: SchematicNode) => void;
}

/** A short state summary, for the wire label. */
function summarise(state: StatePointOutput | null, temp: string): string | null {
  if (!state) return null;
  return `${state.dbt.toFixed(1)} ${temp} · ${state.rh.toFixed(0)}%`;
}

export function SchematicCanvas({
  points,
  processes,
  passThroughs,
  positions,
  resolvedPoints,
  resolvedProcesses,
  kindLabel,
  selectedId,
  isSi,
  onSelectProcess,
  onSelectPoint,
  onMove,
  onConnect,
  onDelete,
}: SchematicCanvasProps) {
  const t = useT();
  const temp = t(isSi ? 'unit.celsius' : 'unit.fahrenheit');

  const layout = useMemo(
    () => layoutDocument(points, processes, passThroughs, positions),
    [points, processes, passThroughs, positions],
  );

  const nodes: Node<BlockNodeData>[] = useMemo(
    () =>
      layout.nodes.map((node) => {
        const at = layout.positions[node.id] ?? { x: 0, y: 0 };
        const resolved =
          node.kind === 'process' ? resolvedProcesses.get(node.id) : undefined;
        const point = node.kind === 'boundary' ? resolvedPoints.get(node.id) : undefined;

        return {
          id: node.id,
          type: 'block',
          position: at,
          selected: node.id === selectedId,
          data: {
            node,
            title:
              node.kind === 'process'
                ? kindLabel(node.process)
                : node.kind === 'boundary'
                  ? node.point.label
                  : node.block.label,
            detail:
              node.kind === 'process'
                ? (summarise(resolved?.outlet ?? null, temp) ?? t('schematic.noOutlet'))
                : node.kind === 'boundary'
                  ? (summarise(point?.state ?? null, temp) ?? t('outline.unresolved'))
                  : t('schematic.inert'),
            // Two inlets only where the physics has two: a mixing box takes
            // outdoor and return air on separate ports, and a coil does not.
            inlets:
              node.kind === 'process'
                ? needsSecondPoint(node.process.kind)
                  ? 2
                  : 1
                : node.kind === 'passThrough'
                  ? 1
                  : 0,
            outlets:
              node.kind === 'process'
                ? node.process.toSecondId
                  ? 2
                  : 1
                : node.kind === 'boundary'
                  ? node.role === 'source'
                    ? 1
                    : 0
                  : 1,
            error: resolved?.error ?? point?.error ?? null,
            // A wet coil and a torn stream are the two things worth seeing
            // without selecting the block.
            badge: resolved?.dehumidified
              ? t('outline.wet')
              : resolved?.tearMismatch
                ? t('schematic.tear')
                : null,
          },
        };
      }),
    [layout, resolvedProcesses, resolvedPoints, selectedId, kindLabel, temp, t],
  );

  /**
   * One edge per wire.
   *
   * A point that is consumed becomes an edge from whatever produced it — or from
   * its own boundary block, when the user typed it. A **tear** is drawn like any
   * other wire and labelled, because the circuit is the thing the user is
   * looking at: hiding the return duct because the resolver cuts it there would
   * make the drawing a lie about the system.
   */
  const edges: Edge[] = useMemo(() => {
    const produced = new Map<string, string>();
    for (const process of processes) {
      for (const outletId of [process.toId, process.toSecondId]) {
        if (outletId) produced.set(outletId, process.id);
      }
    }
    const blocks = new Set(layout.nodes.map((n) => n.id));

    const list: Edge[] = [];
    for (const process of processes) {
      const inlets: [string | null, 'from' | 'second'][] = [
        [process.fromId, 'from'],
        [process.secondId, 'second'],
      ];
      for (const [pointId, slot] of inlets) {
        if (!pointId) continue;
        const source = produced.get(pointId) ?? (blocks.has(pointId) ? pointId : null);
        if (!source) continue;
        const point = points.find((p) => p.id === pointId);
        const torn = point ? isTear(point) : false;
        list.push({
          id: `${source}-${process.id}-${slot}`,
          source,
          target: process.id,
          targetHandle: slot,
          label: summarise(resolvedPoints.get(pointId)?.state ?? null, temp) ?? undefined,
          animated: torn,
          className: torn ? 'wire wire--tear' : 'wire',
          data: { pointId },
        });
      }
    }

    // The last state in a train has no consumer, so it gets a block of its own
    // and a wire from whatever produced it.
    for (const node of layout.nodes) {
      if (node.kind !== 'boundary' || node.role !== 'terminal') continue;
      const source = produced.get(node.id);
      if (!source) continue;
      list.push({
        id: `${source}-${node.id}`,
        source,
        target: node.id,
        label: summarise(resolvedPoints.get(node.id)?.state ?? null, temp) ?? undefined,
        className: 'wire',
        data: { pointId: node.id },
      });
    }
    return list;
  }, [processes, points, layout, resolvedPoints, temp]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<BlockNodeData>>[]) => {
      // Only positions come back to the document. Selection is the document's
      // already, and a removal goes through the document actions so the points
      // a block placed go with it.
      const moved: Record<string, Position> = {};
      for (const change of changes) {
        if (change.type === 'position' && change.position && change.dragging === false) {
          moved[change.id] = change.position;
        }
      }
      if (Object.keys(moved).length > 0) onMove(moved);
    },
    [onMove],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const target = processes.find((p) => p.id === connection.target);
      if (!target) return;
      // The source block's outlet is a point, and that point becomes the target
      // block's inlet: two blocks joined by a wire share one state, which is
      // exactly what the wire means.
      const source = layout.nodes.find((n) => n.id === connection.source);
      if (!source) return;
      const outletPointId =
        source.kind === 'process'
          ? connection.sourceHandle === 'second'
            ? source.process.toSecondId
            : source.process.toId
          : source.kind === 'boundary'
            ? source.point.id
            : null;
      if (!outletPointId) return;
      onConnect(
        outletPointId,
        target.id,
        connection.targetHandle === 'second' ? 'second' : 'from',
      );
    },
    [processes, layout, onConnect],
  );

  return (
    <div className="schematic-canvas" aria-label={t('schematic.canvas')}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onConnect={handleConnect}
        onNodeClick={(_, node) => {
          const block = layout.nodes.find((n) => n.id === node.id);
          if (!block) return;
          if (block.kind === 'process') onSelectProcess(block.id);
          else if (block.kind === 'boundary') onSelectPoint(block.id);
        }}
        onNodesDelete={(deleted) => {
          for (const node of deleted) {
            const block = layout.nodes.find((n) => n.id === node.id);
            if (block) onDelete(block);
          }
        }}
        fitView
        proOptions={{ hideAttribution: false }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

/** The palette, in the order air takes through a plant. */
export const PALETTE: readonly (readonly [string, TranslationKey])[] = [
  ['mix', 'process.mix'],
  ['recovery', 'process.recovery'],
  ['sensible', 'process.sensible'],
  ['cooling', 'process.cooling'],
  ['steam', 'process.steam'],
  ['evaporative', 'process.evaporative'],
  ['desiccant', 'process.desiccant'],
  ['load', 'process.load'],
  ['split', 'process.split'],
];
