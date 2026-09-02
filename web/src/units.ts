/**
 * The units an *input* may be typed in, and how they reach the document.
 *
 * The unit switch in the top nav says what the document is written in, and
 * every derived reading follows it. What it must not decide is what a user is
 * allowed to *type*: a fan is selected in m³/h, a coil is scheduled in kW, a
 * duct traverse comes back in cfm, and a document in SI should take all three
 * without the reader converting on paper first.
 *
 * So each input carries a dimension, each dimension a list of units, and the
 * field converts on the way in. Nothing here is stored: a value entered in °F
 * is converted once and the document keeps the number it always kept, in its
 * own unit system. Change the unit switch and the readings change; change an
 * input's unit and only the way you type it does.
 *
 * **Volumetric flow is converted through the air state, not through a
 * constant.** V̇ and ṁ are related by the dry-air specific volume of the stream
 * — `ṁ = V̇ / v_da` — which is a property of the point the process leaves, not
 * a fixed density. `REQUIREMENTS.md` §3.2 and Gatley both single this out: a
 * mass balance run on moist-air density is wrong by about 1%, and it is wrong
 * silently. The volumetric units below are therefore offered only where the
 * state is in hand, and they use `v_da` when they are.
 */

import type { TranslationKey } from './i18n';

/** The context a state-dependent conversion needs. */
export interface UnitContext {
  /**
   * Dry-air specific volume in m³/kg — SI regardless of the document's units,
   * because every conversion here runs through an SI base.
   */
  vDaSi: number | null;
}

/** One unit a value may be typed in. */
export interface Unit {
  /** Stable id, used as the `<option>` value and in tests. */
  id: string;
  /** The symbol, translated. */
  key: TranslationKey;
  /** Decimals the field shows when it is not being typed into. */
  decimals: number;
  /** Whether the conversion needs the air state — volumetric flow does. */
  needsState?: boolean;
  /** This unit's value → the dimension's SI base value. */
  toBase: (value: number, ctx: UnitContext) => number;
  /** The dimension's SI base value → this unit's value. */
  fromBase: (value: number, ctx: UnitContext) => number;
}

/** A quantity with a base unit and the units it may be typed in. */
export interface Dimension {
  /** Every unit on offer, base first. */
  units: Unit[];
  /** The unit id the document uses in SI. */
  si: string;
  /** The unit id the document uses in IP. */
  ip: string;
}

/** The dimensions an input can carry. */
export type DimensionId =
  | 'temperature'
  | 'temperatureDelta'
  | 'humidityRatio'
  | 'enthalpy'
  | 'flow'
  | 'power'
  | 'length'
  | 'percent'
  | 'ratio';

/** A unit that is a fixed multiple of the base. */
function scaled(
  id: string,
  key: TranslationKey,
  perBase: number,
  decimals: number,
): Unit {
  return {
    id,
    key,
    decimals,
    toBase: (v) => v * perBase,
    fromBase: (v) => v / perBase,
  };
}

/** A volumetric flow unit, in m³/s per unit, converted through `v_da`. */
function volumetric(
  id: string,
  key: TranslationKey,
  m3PerSecond: number,
  decimals: number,
): Unit {
  return {
    id,
    key,
    decimals,
    needsState: true,
    // ṁ = V̇ / v_da, and the inverse. A missing state cannot reach here: the
    // field drops the volumetric units when it has no specific volume.
    toBase: (v, ctx) => (v * m3PerSecond) / (ctx.vDaSi ?? Number.NaN),
    fromBase: (v, ctx) => (v * (ctx.vDaSi ?? Number.NaN)) / m3PerSecond,
  };
}

/** 1 ft³/lb in m³/kg, for reading an IP document's specific volume. */
export const M3_PER_KG_PER_FT3_PER_LB = 0.06242796057614461;

/** Every dimension, with the SI unit first and used as the base. */
export const DIMENSIONS: Record<DimensionId, Dimension> = {
  temperature: {
    si: 'C',
    ip: 'F',
    units: [
      { id: 'C', key: 'unit.celsius', decimals: 2, toBase: (v) => v, fromBase: (v) => v },
      {
        id: 'F',
        key: 'unit.fahrenheit',
        decimals: 2,
        toBase: (v) => ((v - 32) * 5) / 9,
        fromBase: (v) => (v * 9) / 5 + 32,
      },
      {
        id: 'K',
        key: 'unit.kelvin',
        decimals: 2,
        toBase: (v) => v - 273.15,
        fromBase: (v) => v + 273.15,
      },
    ],
  },
  // A step, a spread, a rise: a difference, so it scales and does not offset.
  // 1 °C of bin width is 1.8 °F of bin width, not 33.8.
  temperatureDelta: {
    si: 'K',
    ip: 'dF',
    units: [
      { id: 'K', key: 'unit.celsius', decimals: 2, toBase: (v) => v, fromBase: (v) => v },
      scaled('dF', 'unit.fahrenheit', 5 / 9, 2),
    ],
  },
  humidityRatio: {
    si: 'kg/kg',
    ip: 'lb/lb',
    units: [
      {
        id: 'kg/kg',
        key: 'unit.kgPerKg',
        decimals: 6,
        toBase: (v) => v,
        fromBase: (v) => v,
      },
      scaled('g/kg', 'unit.gramPerKg', 0.001, 3),
      scaled('lb/lb', 'unit.lbPerLb', 1, 6),
      scaled('gr/lb', 'unit.grainsPerLb', 1 / 7000, 1),
    ],
  },
  enthalpy: {
    si: 'kJ/kg',
    ip: 'Btu/lb',
    units: [
      {
        id: 'kJ/kg',
        key: 'unit.kjPerKg',
        decimals: 2,
        toBase: (v) => v,
        fromBase: (v) => v,
      },
      scaled('Btu/lb', 'unit.btuPerLb', 2.326, 2),
    ],
  },
  // Mass and volume in one list, because the question a user answers is "how
  // much air", and whether their figure is a mass or a volume is their answer,
  // not the field's.
  flow: {
    si: 'kg/s',
    ip: 'lb/h',
    units: [
      { id: 'kg/s', key: 'unit.kgPerSecond', decimals: 3, toBase: (v) => v, fromBase: (v) => v },
      scaled('kg/h', 'unit.kgPerHour', 1 / 3600, 1),
      scaled('lb/h', 'unit.lbPerHour', 0.45359237 / 3600, 1),
      volumetric('m3/h', 'unit.m3PerHour', 1 / 3600, 1),
      volumetric('m3/s', 'unit.m3PerSecond', 1, 4),
      volumetric('L/s', 'unit.litrePerSecond', 0.001, 2),
      volumetric('cfm', 'unit.cfm', 0.0283168466 / 60, 0),
    ],
  },
  power: {
    si: 'kW',
    ip: 'Btu/h',
    units: [
      { id: 'kW', key: 'unit.kilowatt', decimals: 2, toBase: (v) => v, fromBase: (v) => v },
      scaled('W', 'unit.watt', 0.001, 0),
      // 1 W = 3.412141633 Btu/h exactly, from the thermochemical Btu.
      scaled('Btu/h', 'unit.btuPerHour', 1 / 3412.141633, 0),
      scaled('ton', 'unit.tonRefrigeration', 3.516852842067, 2),
    ],
  },
  length: {
    si: 'm',
    ip: 'ft',
    units: [
      { id: 'm', key: 'unit.metre', decimals: 0, toBase: (v) => v, fromBase: (v) => v },
      scaled('ft', 'unit.foot', 0.3048, 0),
    ],
  },
  percent: {
    si: '%',
    ip: '%',
    units: [
      { id: '%', key: 'unit.percent', decimals: 2, toBase: (v) => v, fromBase: (v) => v },
    ],
  },
  ratio: {
    si: '-',
    ip: '-',
    units: [
      { id: '-', key: 'unit.none', decimals: 2, toBase: (v) => v, fromBase: (v) => v },
    ],
  },
};

/** A unit by id, within a dimension. */
export function unitById(dimension: DimensionId, id: string): Unit {
  const dim = DIMENSIONS[dimension];
  return dim.units.find((u) => u.id === id) ?? dim.units[0]!;
}

/** The unit the *document* holds this dimension in, given the unit switch. */
export function documentUnit(dimension: DimensionId, isSi: boolean): Unit {
  const dim = DIMENSIONS[dimension];
  return unitById(dimension, isSi ? dim.si : dim.ip);
}

/** Converts between two units of one dimension, through the SI base. */
export function convert(value: number, from: Unit, to: Unit, ctx: UnitContext): number {
  if (from.id === to.id) return value;
  return to.fromBase(from.toBase(value, ctx), ctx);
}

/**
 * Rewrites a value held in one unit system's units for the other's.
 *
 * The unit switch changes what the document *is written in*, and a stored
 * number is a quantity rather than a label: without this, flipping to IP turns
 * a 24 °C room into a 24 °F one and moves every point on the chart.
 */
export function convertForUnits(
  dimension: DimensionId,
  value: number,
  toSi: boolean,
): number {
  return convert(value, documentUnit(dimension, !toSi), documentUnit(dimension, toSi), {
    vDaSi: null,
  });
}

/**
 * The specific volume the flow conversions need, in m³/kg.
 *
 * The engine returns it in the document's units, so an IP document hands back
 * ft³/lb and it is converted here rather than at each call site.
 */
export function specificVolumeSi(
  specificVolume: number | null | undefined,
  isSi: boolean,
): number | null {
  if (specificVolume === null || specificVolume === undefined) return null;
  return isSi ? specificVolume : specificVolume * M3_PER_KG_PER_FT3_PER_LB;
}
