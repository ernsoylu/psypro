/**
 * The Phase 12 exit criterion: save a project, reload, and the point and
 * process set is identical.
 *
 * The round trip is the whole test, and "identical" means identical — not
 * equivalent, not close. A save/open cycle that quietly reorders points or
 * rounds an input is a cycle that changes a user's document without telling
 * them, and it would take several saves before anyone noticed.
 */

import { describe, expect, it } from 'vitest';

import { deserialise, serialise, ProjectFormatError, FORMAT_VERSION } from './format';
import { ChartLayout, InputState } from '../psychro';
import type { ProjectSnapshot } from './format';
import { defaultProcess } from '../store/useProcessStore';
import { TYPED } from '../store/usePsychStore';

/** A project with one of everything the format has to carry. */
function project(): ProjectSnapshot {
  return {
    name: 'Denver office',
    isSi: false,
    altitude: '5280',
    layout: ChartLayout.MollierIx,
    realGas: false,
    points: [
      {
        id: 'pt-1',
        label: 'OA',
        dryBulb: 95.3,
        mode: InputState.DbtRh,
        secondValue: 22,
        source: TYPED,
      },
      {
        id: 'pt-2',
        label: 'RA',
        dryBulb: 75.2,
        mode: InputState.DbtHumidityRatio,
        secondValue: 0.0093401,
        source: TYPED,
      },
      {
        id: 'pt-3',
        label: 'SA',
        dryBulb: 55,
        mode: InputState.DbtWbt,
        secondValue: 54,
        source: TYPED,
      },
    ],
    schematic: {
      // A hand-placed block and a filter on a wire: the two things the
      // schematic section carries that nothing else does.
      positions: { 'pr-1': { x: 260, y: 0 } },
      passThroughs: [
        {
          id: 'pt-through-1',
          kind: 'filter' as const,
          onPointId: 'pt-1',
          label: 'MERV 13',
        },
      ],
    },
    processes: [
      { ...defaultProcess('mix', 'pt-1'), id: 'pr-1', secondId: 'pt-2' },
      { ...defaultProcess('sensible', 'pt-2'), id: 'pr-2' },
    ],
  };
}

describe('the project round trip', () => {
  it('returns a byte-identical document', () => {
    const before = project();
    const after = deserialise(serialise(before, '0.1.0'));
    // Deep equality on the whole snapshot, not a field-by-field spot check: a
    // format that loses one field is exactly as broken as one that loses all of
    // them, and harder to notice.
    expect(after).toEqual(before);
  });

  it('survives a second round trip unchanged', () => {
    const once = deserialise(serialise(project(), '0.1.0'));
    const twice = deserialise(serialise(once, '0.1.0'));
    // A cycle that drifts by a little each time is the failure mode a single
    // round trip cannot see.
    expect(twice).toEqual(once);
  });

  it('keeps full input precision', () => {
    const before = project();
    const after = deserialise(serialise(before, '0.1.0'));
    // The humidity ratio is stored to seven digits; rounding it on save would
    // move the point on reopen, silently.
    expect(after.points[1]!.secondValue).toBe(0.0093401);
  });

  it('carries the settings that invalidate everything else', () => {
    const after = deserialise(serialise(project(), '0.1.0'));
    // A project reopened in the wrong unit system, at the wrong elevation, or
    // with the teaching toggle in the wrong position is a different document.
    expect(after.isSi).toBe(false);
    expect(after.altitude).toBe('5280');
    expect(after.layout).toBe(ChartLayout.MollierIx);
    expect(after.realGas).toBe(false);
  });

  it('stores inputs and nothing derived', () => {
    const text = serialise(project(), '0.1.0');
    const raw = JSON.parse(text);
    for (const point of raw.points) {
      // A file carrying resolved properties disagrees with itself the moment
      // the engine improves, and there is then no way to tell whether an old
      // project's numbers are wrong or merely old.
      expect(Object.keys(point).sort()).toEqual([
        'dryBulb',
        'id',
        'label',
        'mode',
        'secondValue',
        // `source` says which of the two places a point's inputs come from —
        // these fields, or the process that places it — so it is an input
        // itself. Nothing on this list is a resolved property.
        'source',
      ]);
    }
  });

  it('records what wrote it', () => {
    const raw = JSON.parse(serialise(project(), '0.1.0'));
    expect(raw.engine).toBe('0.1.0');
    expect(raw.version).toBe(FORMAT_VERSION);
    expect(Date.parse(raw.savedAt)).not.toBeNaN();
  });
});

describe('reading a file that is not this one', () => {
  it('refuses a newer format rather than half-reading it', () => {
    const raw = JSON.parse(serialise(project(), '0.1.0'));
    raw.version = FORMAT_VERSION + 1;
    // Silently dropping fields this build does not recognise would lose a
    // user's work without telling them it had.
    expect(() => deserialise(JSON.stringify(raw))).toThrow(/newer version/);
  });

  it('refuses a JSON file that is not a project', () => {
    expect(() => deserialise('{"points": []}')).toThrow(ProjectFormatError);
    expect(() => deserialise('not json at all')).toThrow(/valid JSON/);
  });

  it('refuses a point with a missing number rather than reading it as zero', () => {
    const raw = JSON.parse(serialise(project(), '0.1.0'));
    delete raw.points[0].dryBulb;
    // Zero is a temperature. A corrupt file must not open as a plausible one.
    expect(() => deserialise(JSON.stringify(raw))).toThrow(/dry bulb/);
  });

  it('drops a process whose endpoint is not in the file', () => {
    const raw = JSON.parse(serialise(project(), '0.1.0'));
    raw.processes.push({ ...defaultProcess('sensible', 'pt-missing'), id: 'pr-9' });
    const after = deserialise(JSON.stringify(raw));
    // Keeping it would draw a line from nowhere, and the renderer has no way to
    // tell that from a line it should draw.
    expect(after.processes.map((p) => p.id)).toEqual(['pr-1', 'pr-2']);
  });

  it('reads an older file that omits optional fields', () => {
    const minimal = JSON.stringify({
      magic: 'psypro.project',
      version: 1,
      document: { isSi: true, altitude: '0', layout: 0, realGas: true },
      points: [{ id: 'pt-1', label: 'A', dryBulb: 24, mode: 1, secondValue: 50 }],
    });
    const after = deserialise(minimal);
    expect(after.points).toHaveLength(1);
    expect(after.processes).toEqual([]);
    expect(after.name).toBe('');
  });
});
