/**
 * The EPW parser.
 *
 * EnergyPlus Weather files are CSV with eight header lines and then one row per
 * hour of the year. This reads the three columns a psychrometric chart needs and
 * ignores the other thirty, which is not laziness — a file that carries an
 * out-of-range value in a column nobody reads should still load.
 *
 * Pure, synchronous, and free of DOM and WASM references, so it runs in the
 * worker and is testable without either.
 */

/** The columns an EPW row carries, at the indices the format fixes them at. */
const COL_YEAR = 0;
const COL_MONTH = 1;
const COL_DAY = 2;
const COL_HOUR = 3;
const COL_DRY_BULB = 6;
const COL_DEW_POINT = 7;
const COL_RELATIVE_HUMIDITY = 8;
const COL_PRESSURE = 9;

/**
 * The sentinels EPW uses for "no observation".
 *
 * 99.9 for a temperature and 999999 for a pressure. Binning them would put a
 * spike of phantom hours at 99.9 °C, which looks like data.
 */
const MISSING_TEMPERATURE = 99.9;
const MISSING_PRESSURE = 999999;

/** A parsed weather year. */
export interface WeatherYear {
  /** Station name, from the LOCATION header. */
  location: string;
  /** Site elevation in metres, from the LOCATION header. */
  elevationM: number;
  /** Dry-bulb temperature per hour, °C. */
  dryBulb: Float64Array;
  /** Dew-point temperature per hour, °C. */
  dewPoint: Float64Array;
  /** Relative humidity per hour, percent. */
  relativeHumidity: Float64Array;
  /** Station pressure per hour, Pa. */
  pressure: Float64Array;
  /** Hours parsed. */
  hours: number;
  /** Rows rejected, and why they are counted rather than dropped. */
  rejected: number;
}

/** Why a file could not be read as EPW. */
export class EpwError extends Error {}

/**
 * Parses an EPW file.
 *
 * @throws {EpwError} when the file has no LOCATION header or no usable rows.
 */
export function parseEpw(text: string): WeatherYear {
  const lines = text.split(/\r?\n/);
  if (lines.length < 9) {
    throw new EpwError('not an EPW file: fewer than nine lines');
  }

  const header = (lines[0] ?? '').split(',');
  if (header[0]?.toUpperCase() !== 'LOCATION') {
    throw new EpwError('not an EPW file: the first line is not a LOCATION header');
  }
  const location = [header[1], header[3], header[4]].filter(Boolean).join(', ');
  // The LOCATION header's last field is site elevation in metres. It matters:
  // every property in the file was observed at that station's pressure.
  const elevationM = Number(header[9]) || 0;

  const dryBulb: number[] = [];
  const dewPoint: number[] = [];
  const relativeHumidity: number[] = [];
  const pressure: number[] = [];
  let rejected = 0;

  // Data begins after eight header lines: LOCATION, DESIGN CONDITIONS,
  // TYPICAL/EXTREME PERIODS, GROUND TEMPERATURES, HOLIDAYS/DAYLIGHT SAVINGS,
  // three COMMENTS/DATA PERIODS lines.
  for (let i = 8; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const cells = line.split(',');
    if (cells.length <= COL_PRESSURE) {
      rejected += 1;
      continue;
    }

    const db = Number(cells[COL_DRY_BULB]);
    const dp = Number(cells[COL_DEW_POINT]);
    const rh = Number(cells[COL_RELATIVE_HUMIDITY]);
    const p = Number(cells[COL_PRESSURE]);

    // A sentinel is not a reading. Binning 99.9 would put a spike of phantom
    // hours at the right-hand edge of the chart, and it would look like data.
    if (
      !Number.isFinite(db) ||
      !Number.isFinite(dp) ||
      db >= MISSING_TEMPERATURE ||
      dp >= MISSING_TEMPERATURE
    ) {
      rejected += 1;
      continue;
    }

    dryBulb.push(db);
    dewPoint.push(dp);
    relativeHumidity.push(Number.isFinite(rh) ? rh : Number.NaN);
    pressure.push(Number.isFinite(p) && p < MISSING_PRESSURE ? p : Number.NaN);
  }

  if (dryBulb.length === 0) {
    throw new EpwError('the file has no usable hourly rows');
  }

  return {
    location,
    elevationM,
    dryBulb: Float64Array.from(dryBulb),
    dewPoint: Float64Array.from(dewPoint),
    relativeHumidity: Float64Array.from(relativeHumidity),
    pressure: Float64Array.from(pressure),
    hours: dryBulb.length,
    rejected,
  };
}

/** The header columns, exported so a CSV importer can reuse the indices. */
export const EPW_COLUMNS = {
  COL_YEAR,
  COL_MONTH,
  COL_DAY,
  COL_HOUR,
  COL_DRY_BULB,
  COL_DEW_POINT,
  COL_RELATIVE_HUMIDITY,
  COL_PRESSURE,
} as const;
