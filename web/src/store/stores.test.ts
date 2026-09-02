/**
 * The three stores, exercised without React.
 *
 * That is the point of them being plain Zustand rather than `useState` in a
 * component: a contributor can change how a point is stored and find out
 * whether they broke anything in milliseconds, without a DOM.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ChartLayout, CurveFamilyId, InputState } from '../psychro';
import { altitudeInMetres, useProjectStore } from './useProjectStore';
import { nextLabel, resetIdCounter, selectedPoint, usePsychStore } from './usePsychStore';
import { isCurveVisible, useStyleStore } from './useStyleStore';

const project = () => useProjectStore.getState();
const psych = () => usePsychStore.getState();
const style = () => useStyleStore.getState();

beforeEach(() => {
  resetIdCounter();
  usePsychStore.setState({ points: [], selectedId: null });
  useProjectStore.setState({
    isSi: true,
    altitude: '0',
    layout: ChartLayout.Ashrae,
    realGas: true,
    name: '',
  });
  useStyleStore.setState({ showLabels: true, showCrosshair: true });
});

describe('project store', () => {
  it('converts elevation to the metres the engine takes', () => {
    useProjectStore.setState({ isSi: true, altitude: '1609' });
    expect(altitudeInMetres(project())).toBeCloseTo(1609, 9);

    // Unit handling lives at the WASM boundary and nowhere else; this is the
    // one conversion the frontend owns, so it is the one that can be wrong.
    useProjectStore.setState({ isSi: false, altitude: '5280' });
    expect(altitudeInMetres(project())).toBeCloseTo(1609.344, 6);
  });

  it('reads a half-typed elevation as zero rather than NaN', () => {
    for (const partial of ['', '-', '.', 'abc']) {
      useProjectStore.setState({ altitude: partial });
      // A NaN here would poison every property on the chart rather than just
      // this field, which is a very confusing way to learn you mistyped.
      expect(altitudeInMetres(project())).toBe(0);
    }
  });
});

describe('point store', () => {
  it('stores the inputs that define a point, not the properties they resolve to', () => {
    const id = psych().addPoint({
      label: 'OA',
      dryBulb: 35,
      mode: InputState.DbtRh,
      secondValue: 40,
    });
    const stored = psych().points.find((p) => p.id === id);
    // Two numbers and a mode. Storing the twelve derived properties would leave
    // a document full of readings taken at a pressure it is no longer at.
    expect(Object.keys(stored ?? {}).sort()).toEqual([
      'dryBulb',
      'id',
      'label',
      'mode',
      'secondValue',
    ]);
  });

  it('selects a point as it is added, so click-to-place is one gesture', () => {
    const id = psych().addPoint({
      label: 'OA',
      dryBulb: 35,
      mode: InputState.DbtRh,
      secondValue: 40,
    });
    expect(psych().selectedId).toBe(id);
    expect(selectedPoint(psych())?.label).toBe('OA');
  });

  it('patches a point without disturbing its neighbours or its identity', () => {
    const a = psych().addPoint({
      label: 'OA',
      dryBulb: 35,
      mode: InputState.DbtRh,
      secondValue: 40,
    });
    const b = psych().addPoint({
      label: 'RA',
      dryBulb: 24,
      mode: InputState.DbtRh,
      secondValue: 50,
    });

    psych().updatePoint(a, { dryBulb: 30, mode: InputState.DbtHumidityRatio, secondValue: 0.012 });

    const first = psych().points.find((p) => p.id === a);
    expect(first).toMatchObject({ id: a, label: 'OA', dryBulb: 30, secondValue: 0.012 });
    // A drag rewrites the mode as well as the value, which must not touch the
    // label the user typed.
    expect(psych().points.find((p) => p.id === b)).toMatchObject({
      label: 'RA',
      dryBulb: 24,
    });
  });

  it('clears the selection when the selected point is removed', () => {
    const id = psych().addPoint({
      label: 'OA',
      dryBulb: 35,
      mode: InputState.DbtRh,
      secondValue: 40,
    });
    psych().removePoint(id);
    expect(psych().selectedId).toBeNull();
    expect(selectedPoint(psych())).toBeNull();
  });

  it('leaves the selection alone when a different point is removed', () => {
    const keep = psych().addPoint({
      label: 'OA',
      dryBulb: 35,
      mode: InputState.DbtRh,
      secondValue: 40,
    });
    const drop = psych().addPoint({
      label: 'RA',
      dryBulb: 24,
      mode: InputState.DbtRh,
      secondValue: 50,
    });
    psych().selectPoint(keep);
    psych().removePoint(drop);
    expect(psych().selectedId).toBe(keep);
  });

  it('names points after the return-air cycle, then falls back to numbering', () => {
    const taken: { label: string }[] = [];
    for (const expected of ['OA', 'RA', 'MA', 'CL', 'SA']) {
      const label = nextLabel(taken as never);
      expect(label).toBe(expected);
      taken.push({ label });
    }
    // Past the cycle, guessing further is worse than not guessing.
    expect(nextLabel(taken as never)).toBe('P6');
  });

  it('reuses a freed cycle name rather than skipping to a number', () => {
    const taken = [{ label: 'OA' }, { label: 'MA' }] as never;
    expect(nextLabel(taken)).toBe('RA');
  });
});

describe('style store', () => {
  it('hides a family when it is switched off', () => {
    const visible = { ...style().visible, [CurveFamilyId.WetBulb]: false };
    expect(isCurveVisible(visible, CurveFamilyId.WetBulb, 20)).toBe(false);
    expect(isCurveVisible(visible, CurveFamilyId.DryBulb, 25)).toBe(true);
  });

  it('never hides the saturation curve, even with relative humidity off', () => {
    const visible = { ...style().visible, [CurveFamilyId.RelativeHumidity]: false };
    // Saturation IS 100% RH, so switching the family off would take it with it.
    // It is the boundary of the physical region, not one more gridline: a chart
    // without it does not say where air stops being air.
    expect(isCurveVisible(visible, CurveFamilyId.RelativeHumidity, 1)).toBe(true);
    expect(isCurveVisible(visible, CurveFamilyId.RelativeHumidity, 0.5)).toBe(false);
  });

  it('toggles a family without touching the others', () => {
    style().toggleFamily(CurveFamilyId.Enthalpy);
    expect(style().visible[CurveFamilyId.Enthalpy]).toBe(false);
    expect(style().visible[CurveFamilyId.DryBulb]).toBe(true);
    style().toggleFamily(CurveFamilyId.Enthalpy);
    expect(style().visible[CurveFamilyId.Enthalpy]).toBe(true);
  });
});
