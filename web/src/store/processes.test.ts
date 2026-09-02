/**
 * The process store, and what happens to a process when its endpoints move.
 *
 * The invariant worth testing is the one that is easy to break by accident: a
 * process is defined *relative to points*, so deleting a point has to take its
 * processes with it. Leaving them behind draws a line from nowhere, and the
 * renderer would have no way to tell that from a line it should draw.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  defaultProcess,
  resetProcessIdCounter,
  useProcessStore,
} from './useProcessStore';

const store = () => useProcessStore.getState();

beforeEach(() => {
  resetProcessIdCounter();
  useProcessStore.setState({ processes: [], selectedId: null });
});

describe('process store', () => {
  it('stores what a process does, not where it ends up', () => {
    const id = store().addProcess(defaultProcess('sensible', 'pt-1'));
    const stored = store().processes.find((p) => p.id === id);
    // No outlet field anywhere. Change the elevation and the outlet moves,
    // because the physics moved; a stored one would not.
    expect(stored).not.toHaveProperty('outlet');
    expect(stored).toMatchObject({ kind: 'sensible', fromId: 'pt-1' });
  });

  it('gives a new process defaults that resolve to something visible', () => {
    // "Add a process, then fill in six numbers before anything appears" is how
    // a tool loses a student in the first minute.
    const d = defaultProcess('evaporative', 'pt-1');
    expect(d.mdot).toBeGreaterThan(0);
    expect(d.effectiveness).toBeGreaterThan(0);
    expect(d.effectiveness).toBeLessThanOrEqual(1);
    // 300 mm rigid media, from the table in REQUIREMENTS §4.3.
    expect(d.effectiveness).toBeCloseTo(0.88, 6);
    // Dry saturated steam at 100 C.
    expect(d.steamEnthalpy).toBeCloseTo(2676, 6);
  });

  it('selects a process as it is added', () => {
    const id = store().addProcess(defaultProcess('mix', 'pt-1'));
    expect(store().selectedId).toBe(id);
  });

  it('drops every process touching a deleted point', () => {
    const a = store().addProcess(defaultProcess('sensible', 'pt-1'));
    const b = store().addProcess({
      ...defaultProcess('mix', 'pt-2'),
      secondId: 'pt-1',
    });
    const c = store().addProcess(defaultProcess('sensible', 'pt-3'));

    store().removeForPoint('pt-1');

    const kept = store().processes.map((p) => p.id);
    // Both the one starting at the point and the one referring to it as its
    // second stream: either would draw a line from nowhere.
    expect(kept).not.toContain(a);
    expect(kept).not.toContain(b);
    expect(kept).toContain(c);
  });

  it('clears a selection that the point deletion invalidated', () => {
    const a = store().addProcess(defaultProcess('sensible', 'pt-1'));
    store().selectProcess(a);
    store().removeForPoint('pt-1');
    expect(store().selectedId).toBeNull();
  });

  it('keeps a selection the point deletion did not touch', () => {
    store().addProcess(defaultProcess('sensible', 'pt-1'));
    const keep = store().addProcess(defaultProcess('sensible', 'pt-2'));
    store().selectProcess(keep);
    store().removeForPoint('pt-1');
    expect(store().selectedId).toBe(keep);
  });

  it('patches one process without disturbing its neighbours', () => {
    const a = store().addProcess(defaultProcess('sensible', 'pt-1'));
    const b = store().addProcess(defaultProcess('steam', 'pt-2'));
    store().updateProcess(a, { targetT: 42, mdot: 3 });

    expect(store().processes.find((p) => p.id === a)).toMatchObject({
      targetT: 42,
      mdot: 3,
      kind: 'sensible',
    });
    expect(store().processes.find((p) => p.id === b)).toMatchObject({
      kind: 'steam',
      mdot: 1,
    });
  });
});
