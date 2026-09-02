/**
 * The bridge from stored inputs to resolved properties.
 *
 * The property under test is that resolution is a *derivation*, never a second
 * copy of state. A point stores two numbers; changing elevation must change what
 * those two numbers mean, and a stored property snapshot would silently keep
 * reporting a reading taken at a pressure the document is no longer at.
 */

import { describe, expect, it, vi } from 'vitest';

let calls: { altitude: number; isSi: boolean; realGas: boolean }[] = [];

vi.mock('../psychro', () => {
  const InputState = {
    DbtWbt: 0,
    DbtRh: 1,
    DbtDewPoint: 2,
    DbtHumidityRatio: 3,
    DbtEnthalpy: 4,
  } as const;
  const ChartLayout = { Ashrae: 0, MollierIx: 1 } as const;
  class StatePointInput {
    constructor(
      public dbt: number,
      public val2: number,
      public state_type: number,
      public altitude: number,
      public is_si: boolean,
      public real_gas: boolean,
    ) {}
  }
  return {
    InputState,
    ChartLayout,
    StatePointInput,
    calculate_state: (input: StatePointInput) => {
      calls.push({
        altitude: input.altitude,
        isSi: input.is_si,
        realGas: input.real_gas,
      });
      if (input.val2 > 100) throw new Error('humidity ratio above saturation');
      // Altitude shows up in the answer, so a stale resolution is detectable.
      return { dbt: input.dbt, humidity_ratio: 0.009 + input.altitude * 1e-6 };
    },
    get_coordinate_mapping: (input: StatePointInput) => ({
      x: input.dbt,
      y: 0.009 + input.altitude * 1e-6,
    }),
  };
});

const { resolvePoint } = await import('./useResolvedPoints');
const { InputState, ChartLayout } = await import('../psychro');

const POINT = {
  id: 'pt-1',
  label: 'OA',
  dryBulb: 24,
  mode: InputState.DbtRh,
  secondValue: 50,
};

const SEA_LEVEL = {
  isSi: true,
  altitudeM: 0,
  realGas: true,
  layout: ChartLayout.Ashrae,
};

describe('resolvePoint', () => {
  it('resolves a point to properties and a chart position', () => {
    const r = resolvePoint(POINT, SEA_LEVEL);
    expect(r.error).toBeNull();
    expect(r.state).not.toBeNull();
    expect(r.position).toEqual({ x: 24, y: 0.009 });
  });

  it('re-resolves from the stored inputs when elevation changes', () => {
    const sea = resolvePoint(POINT, SEA_LEVEL);
    const denver = resolvePoint(POINT, { ...SEA_LEVEL, altitudeM: 1609 });
    // Same two stored numbers, different answer. If the point had stored its
    // resolved properties instead, this would be unchanged and wrong.
    expect(denver.state?.humidity_ratio).not.toBe(sea.state?.humidity_ratio);
  });

  it('passes the document settings through to the engine, not defaults', () => {
    calls = [];
    resolvePoint(POINT, {
      isSi: false,
      altitudeM: 1609,
      realGas: false,
      layout: ChartLayout.Ashrae,
    });
    expect(calls[0]).toEqual({ altitude: 1609, isSi: false, realGas: false });
  });

  it('reports an unphysical state as an outcome, not an exception', () => {
    // Dragging a marker above the saturation curve is something a user does
    // within seconds of picking up the tool. The panel needs to say why.
    const r = resolvePoint({ ...POINT, secondValue: 900 }, SEA_LEVEL);
    expect(r.state).toBeNull();
    expect(r.position).toBeNull();
    expect(r.error).toMatch(/saturation/);
  });
});
