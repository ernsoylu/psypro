/**
 * One block on the schematic: a piece of equipment, a boundary, or an inert
 * component.
 *
 * Plain HTML inside React Flow's node wrapper rather than SVG or canvas. The
 * Process Design page made that choice for its static strip and gave the reason
 * — a schematic is boxes with text in them, and the browser already lays those
 * out, makes them selectable, and reads them to a screen reader. The reasoning
 * holds harder here: an editor's blocks carry live readings that a screen reader
 * has to be able to reach.
 *
 * The ports are the only part that is not ordinary markup. React Flow needs a
 * `Handle` per connection point, and their *count* comes from the physics: a
 * mixing box has two inlets because adiabatic mixing has two streams, and a
 * split has two outlets because it divides one. A block never offers a port the
 * process behind it could not use.
 */

import { Handle, Position as HandlePosition, type NodeProps } from '@xyflow/react';

import { Icon, type IconName } from '../shell/Icon';
import type { ProcessKind } from '../store/useProcessStore';
import type { PassThroughKind, SchematicNode } from '../store/useSchematicStore';

/** What a block needs to draw itself. */
export interface BlockNodeData extends Record<string, unknown> {
  /** What this block stands for in the document. */
  node: SchematicNode;
  /** The block's name. */
  title: string;
  /** The state leaving it, or why there is none. */
  detail: string;
  /** How many inlet ports it offers. */
  inlets: number;
  /** How many outlet ports it offers. */
  outlets: number;
  /** Why it could not be resolved, if it could not. */
  error: string | null;
  /** A short mark for something worth seeing without selecting the block. */
  badge: string | null;
}

/**
 * The icon each kind of equipment carries.
 *
 * Drawn from the existing icon set rather than a new one: this landing is about
 * the circuit being editable, and a bespoke symbol per component is a separate
 * piece of work with its own standards question (ASHRAE and ISO draw a cooling
 * coil differently).
 */
const PROCESS_ICON: Record<ProcessKind, IconName> = {
  sensible: 'sun',
  sensibleDuty: 'sun',
  cooling: 'point',
  steam: 'process',
  evaporative: 'process',
  desiccant: 'process',
  recovery: 'process',
  mix: 'shape',
  load: 'shape',
  split: 'layers',
  link: 'process',
};

const PASS_THROUGH_ICON: Record<PassThroughKind, IconName> = {
  filter: 'layers',
  damper: 'shape',
  attenuator: 'layers',
  plenum: 'shape',
};

/** The icon for whatever this block stands for. */
function iconFor(node: SchematicNode): IconName {
  if (node.kind === 'process') return PROCESS_ICON[node.process.kind];
  if (node.kind === 'passThrough') return PASS_THROUGH_ICON[node.block.kind];
  return node.role === 'source' ? 'open' : 'fit';
}

export function BlockNode({ data, selected }: NodeProps & { data: BlockNodeData }) {
  const { node, title, detail, inlets, outlets, error, badge } = data;

  const classes = ['block-node'];
  if (selected) classes.push('is-selected');
  if (error) classes.push('has-error');
  // An inert block is drawn quieter than equipment, because it is: §4.7 says a
  // filter carries no process, and a block that looks like a coil would imply
  // one.
  if (node.kind === 'passThrough') classes.push('block-node--inert');
  if (node.kind === 'boundary') classes.push('block-node--boundary');

  return (
    <div className={classes.join(' ')}>
      {/* Inlets on the left, outlets on the right: air runs left to right, which
          is what the auto-layout arranges the columns to match. */}
      {inlets > 0 ? (
        <Handle type="target" position={HandlePosition.Left} id="from" />
      ) : null}
      {inlets > 1 ? (
        <Handle
          type="target"
          position={HandlePosition.Left}
          id="second"
          style={{ top: '72%' }}
        />
      ) : null}

      <span className="block-node__head">
        <Icon name={iconFor(node)} size={15} />
        <span className="block-node__title">{title}</span>
        {badge ? <span className="block-node__badge">{badge}</span> : null}
      </span>
      <span className="block-node__detail">{error ?? detail}</span>

      {outlets > 0 ? (
        <Handle type="source" position={HandlePosition.Right} id="first" />
      ) : null}
      {outlets > 1 ? (
        <Handle
          type="source"
          position={HandlePosition.Right}
          id="second"
          style={{ top: '72%' }}
        />
      ) : null}
    </div>
  );
}
