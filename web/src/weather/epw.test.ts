/**
 * The EPW parser, and the two failures that would look like data.
 *
 * A weather file is the one input a user brings from outside, so it is the one
 * place where a malformed row can quietly become a design decision. Both tests
 * below are about a bad row rendering as something plausible rather than as an
 * error.
 */

import { describe, expect, it } from 'vitest';

import { EpwError, parseEpw } from './epw';

/** A minimal but structurally real EPW: eight header lines, then rows. */
function epw(rows: string[]): string {
  return [
    'LOCATION,Chicago Ohare Intl Ap,IL,USA,TMY3,725300,41.98,-87.92,-6.0,201.0',
    'DESIGN CONDITIONS,0',
    'TYPICAL/EXTREME PERIODS,0',
    'GROUND TEMPERATURES,0',
    'HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0',
    'COMMENTS 1,',
    'COMMENTS 2,',
    'DATA PERIODS,1,1,Data,Sunday, 1/ 1,12/31',
    ...rows,
  ].join('\n');
}

/** One data row: dry bulb, dew point, RH, pressure at their fixed columns. */
function row(db: number, dp: number, rh = 50, p = 101325): string {
  return `1990,1,1,1,60,A9A9,${db},${dp},${rh},${p},0,0,0,0,0,0,0,0,0,0`;
}

describe('the EPW parser', () => {
  it('reads the station, its elevation, and the hours', () => {
    const year = parseEpw(epw([row(-3.9, -6.7), row(-2.8, -5.6), row(0.6, -3.3)]));
    expect(year.location).toContain('Chicago');
    // Elevation matters: every property in the file was observed at that
    // station's pressure, not at sea level.
    expect(year.elevationM).toBe(201);
    expect(year.hours).toBe(3);
    expect(Array.from(year.dryBulb)).toEqual([-3.9, -2.8, 0.6]);
    expect(Array.from(year.dewPoint)).toEqual([-6.7, -5.6, -3.3]);
  });

  it('rejects the missing-value sentinel rather than binning it', () => {
    // EPW writes 99.9 for "no observation". Binning that would put a spike of
    // phantom hours at the right-hand edge of the chart, and it would look
    // exactly like a hot climate.
    const year = parseEpw(epw([row(20, 10), row(99.9, 10), row(20, 99.9), row(22, 11)]));
    expect(year.hours).toBe(2);
    expect(year.rejected).toBe(2);
    expect(Array.from(year.dryBulb)).toEqual([20, 22]);
  });

  it('rejects a truncated row rather than reading a shifted column', () => {
    // A short row would otherwise read whatever happened to be in position 6,
    // which is a number and therefore looks like a temperature.
    const year = parseEpw(epw([row(20, 10), '1990,1,1,2,60,A9A9,21', row(22, 11)]));
    expect(year.hours).toBe(2);
    expect(year.rejected).toBe(1);
  });

  it('refuses a file that is not an EPW', () => {
    expect(() => parseEpw('a,b,c\n1,2,3')).toThrow(EpwError);
    expect(() => parseEpw(epw([]))).toThrow(EpwError);
  });

  it('keeps a full year without losing an hour', () => {
    const rows = Array.from({ length: 8760 }, (_, i) =>
      row(10 + 15 * Math.sin(i / 1400), 5 + 10 * Math.sin(i / 1400)),
    );
    const year = parseEpw(epw(rows));
    expect(year.hours).toBe(8760);
    expect(year.rejected).toBe(0);
    // Typed arrays, so the worker can transfer them by pointer rather than
    // structured-cloning a megabyte of doubles back to the main thread.
    expect(year.dryBulb).toBeInstanceOf(Float64Array);
  });
});
