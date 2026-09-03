/**
 * The unit conversions, held against figures an engineer would recognise.
 *
 * Three of these are the ones that go wrong in practice, so they are asserted
 * rather than assumed: a temperature *difference* scales where a temperature
 * offsets, grains and kilograms are three orders of magnitude apart, and a
 * volumetric flow is a mass flow only through the dry-air specific volume of
 * the stream it is measured in.
 */

import { describe, expect, it } from 'vitest';

import { DIMENSIONS, convert, documentUnit, specificVolumeSi, unitById } from './units';

const NO_STATE = { vDaSi: null };

describe('temperature', () => {
  it('offsets, both ways', () => {
    const c = unitById('temperature', 'C');
    const f = unitById('temperature', 'F');
    const k = unitById('temperature', 'K');
    expect(convert(24, c, f, NO_STATE)).toBeCloseTo(75.2, 10);
    expect(convert(95, f, c, NO_STATE)).toBeCloseTo(35, 10);
    expect(convert(0, c, k, NO_STATE)).toBeCloseTo(273.15, 10);
  });

  it('scales instead when it is a difference', () => {
    // A 1 °C bin is 1.8 °F wide. Offsetting it would make it 33.8, which is
    // the whole reason a delta is a dimension of its own here.
    const k = unitById('temperatureDelta', 'K');
    const dF = unitById('temperatureDelta', 'dF');
    expect(convert(1, k, dF, NO_STATE)).toBeCloseTo(1.8, 10);
    expect(convert(9, dF, k, NO_STATE)).toBeCloseTo(5, 10);
  });
});

describe('humidity ratio', () => {
  it('agrees with the grains and grams a chart is labelled in', () => {
    const kg = unitById('humidityRatio', 'kg/kg');
    expect(convert(0.009, kg, unitById('humidityRatio', 'g/kg'), NO_STATE)).toBeCloseTo(
      9,
      10,
    );
    expect(convert(0.01, kg, unitById('humidityRatio', 'gr/lb'), NO_STATE)).toBeCloseTo(
      70,
      10,
    );
  });
});

describe('enthalpy and power', () => {
  it('uses the exact Btu, not a rounded one', () => {
    expect(
      convert(1, unitById('enthalpy', 'Btu/lb'), unitById('enthalpy', 'kJ/kg'), NO_STATE),
    ).toBeCloseTo(2.326, 12);
  });

  it('knows a ton of refrigeration', () => {
    expect(
      convert(1, unitById('power', 'ton'), unitById('power', 'kW'), NO_STATE),
    ).toBeCloseTo(3.5168528, 6);
    expect(
      convert(12000, unitById('power', 'Btu/h'), unitById('power', 'kW'), NO_STATE),
    ).toBeCloseTo(3.5168528, 4);
  });
});

describe('flow', () => {
  const kgs = unitById('flow', 'kg/s');

  it('converts mass units without needing a state', () => {
    expect(convert(3600, unitById('flow', 'kg/h'), kgs, NO_STATE)).toBeCloseTo(1, 10);
    expect(DIMENSIONS.flow.units.find((u) => u.id === 'kg/h')?.needsState).toBeFalsy();
  });

  it('converts a volume to a mass through v_da, not through a density', () => {
    // 3600 m³/h at v_da = 0.8500 m³/kg is 1 m³/s ÷ 0.85 = 1.17647 kg/s. Using
    // moist-air density instead would be about 1% out, silently — §3.2's third
    // distinction, and the reason this conversion takes the state at all.
    const ctx = { vDaSi: 0.85 };
    expect(convert(3600, unitById('flow', 'm3/h'), kgs, ctx)).toBeCloseTo(1 / 0.85, 10);
    expect(convert(1 / 0.85, kgs, unitById('flow', 'm3/h'), ctx)).toBeCloseTo(3600, 8);
  });

  it('marks every volumetric unit as needing the state', () => {
    for (const id of ['m3/h', 'm3/s', 'L/s', 'cfm']) {
      expect(unitById('flow', id).needsState).toBe(true);
    }
  });

  it('converts cfm at standard-ish air the way a duct traverse would', () => {
    // 1000 cfm is 0.47195 m³/s, and at v_da = 0.8333 m³/kg that is 0.5663 kg/s.
    const mdot = convert(1000, unitById('flow', 'cfm'), kgs, { vDaSi: 0.8333 });
    expect(mdot).toBeCloseTo(0.47195 / 0.8333, 4);
  });
});

describe('the document unit', () => {
  it('follows the unit switch', () => {
    expect(documentUnit('temperature', true).id).toBe('C');
    expect(documentUnit('temperature', false).id).toBe('F');
    expect(documentUnit('flow', true).id).toBe('kg/s');
    expect(documentUnit('flow', false).id).toBe('lb/h');
  });

  it('reads an IP document specific volume as m³/kg', () => {
    // 13.35 ft³/lb is 0.8334 m³/kg. Feeding ft³/lb straight into ṁ = V̇ / v_da
    // would be wrong by a factor of sixteen.
    expect(specificVolumeSi(13.35, false)).toBeCloseTo(0.8334, 3);
    expect(specificVolumeSi(0.85, true)).toBe(0.85);
    expect(specificVolumeSi(null, true)).toBeNull();
  });
});
