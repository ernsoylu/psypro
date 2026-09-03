/**
 * What units the weather worker speaks to the engine in.
 *
 * The engine takes **one** `is_si` flag per resolved year and applies it to
 * everything downstream: the observations it is handed, the free-cooling
 * thresholds, the envelope bounds, and the units the bins come back in. Almost
 * none of those follow the document. An EPW's dry-bulb and dew-point columns
 * are °C by the file format, the design thresholds and the published envelope
 * limits are SI in `data/`, and the bins are consumed by `chart_lattice`, which
 * is geometry over °C.
 *
 * Passing the *document's* unit system therefore reinterpreted °C as °F in four
 * places at once, and an IP document got a heatmap drawn in the wrong part of
 * the chart and hour counts taken against a −10 °C supply condition. Neither
 * looked like a bug: they looked like a different climate.
 *
 * So this asserts the boundary rather than the arithmetic — the engine is
 * mocked, and what is under test is which numbers reach it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveWeather = vi.fn();
const binWeatherData = vi.fn();
const countFreeCoolingHours = vi.fn();
const countHoursInside = vi.fn();

vi.mock('../wasm/psychro', () => ({
  default: () => Promise.resolve(),
  // The mock reproduces the engine's unit rule rather than ignoring it: one
  // `is_si` flag travels with the resolved year and decides what the bins come
  // back in. A mock that always answered in °C would pass the broken code.
  resolve_weather: (...args: unknown[]) => {
    resolveWeather(...args);
    return { skipped: 0, isSi: args[3] as boolean, free: () => undefined };
  },
  bin_weather_data: (year: { isSi: boolean }, ...rest: unknown[]) => {
    binWeatherData(year, ...rest);
    const asDocument = (c: number) => (year.isSi ? c : c * 1.8 + 32);
    const asDelta = (k: number) => (year.isSi ? k : k * 1.8);
    return {
      t_min: asDocument(-5),
      w_min: 0,
      t_step: asDelta(1),
      w_step: 0.001,
      t_count: 2,
      w_count: 2,
      counts: [1, 0, 0, 1],
      peak: 1,
      binned: 2,
      skipped: 0,
      free: () => undefined,
    };
  },
  count_free_cooling_hours: (...args: unknown[]) => {
    countFreeCoolingHours(...args);
    return { economizer: 1, evaporative: 0, mechanical: 0, heating: 1, skipped: 0 };
  },
  count_hours_inside: (...args: unknown[]) => {
    countHoursInside(...args);
    return 2;
  },
}));

await import('./epw.worker');
const { WEATHER_DESIGN_SI } = await import('../weather/design');

/** A two-row EPW, which is all the parser needs to produce a year. */
const EPW = [
  'LOCATION,Chicago,IL,USA,TMY3,725300,41.98,-87.92,-6.0,201.0',
  'DESIGN CONDITIONS,0',
  'TYPICAL/EXTREME PERIODS,0',
  'GROUND TEMPERATURES,0',
  'HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0',
  'COMMENTS 1,',
  'COMMENTS 2,',
  'DATA PERIODS,1,1,Data,Sunday,1/1,12/31',
  '1990,1,1,1,60,A,-3.0,-6.0,80,98700,0,0,0,0',
  '1990,1,1,2,60,A,26.0,12.0,42,98700,0,0,0,0',
].join('\n');

/** Posts one request into the worker and waits for its reply. */
function analyse(request: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const post = vi
      .spyOn(self, 'postMessage')
      .mockImplementation(((message: unknown) => {
        post.mockRestore();
        const reply = message as { ok: boolean; error?: string };
        if (reply.ok) resolve(reply);
        else reject(new Error(reply.error));
      }) as typeof self.postMessage);

    self.onmessage?.(new MessageEvent('message', { data: request }));
  });
}

const BASE = {
  text: EPW,
  token: 1,
  altitudeM: 201,
  binStepT: 1,
  binStepW: 0.001,
  design: WEATHER_DESIGN_SI,
  envelopes: [{ id: 'tc99-recommended', bounds: [18, 27, -9, 15, NaN, 60, NaN, NaN] }],
};

describe('the weather worker', () => {
  beforeEach(() => {
    resolveWeather.mockClear();
    binWeatherData.mockClear();
    countFreeCoolingHours.mockClear();
    countHoursInside.mockClear();
  });

  it('resolves the year in SI whatever the document is written in', async () => {
    await analyse({ ...BASE, isSi: false });

    const [dryBulb, dewPoint, altitude, isSi] = resolveWeather.mock.calls[0]!;
    // The file's own numbers, untouched: an EPW carries °C by the format, and
    // reading them as °F turns a −3 °C hour into −19 °C.
    expect(Array.from(dryBulb as Float64Array)).toEqual([-3, 26]);
    expect(Array.from(dewPoint as Float64Array)).toEqual([-6, 12]);
    // Metres, and the SI flag that says so.
    expect(altitude).toBe(201);
    expect(isSi).toBe(true);
  });

  it('takes the free-cooling counts against the SI design thresholds', async () => {
    await analyse({ ...BASE, isSi: false });

    const [, tSupply, hReturn, tHighLimit] = countFreeCoolingHours.mock.calls[0]!;
    // 13 °C, not f_to_c(13) = −10.6 °C. The second reads as a climate where
    // almost every hour needs heating.
    expect(tSupply).toBe(WEATHER_DESIGN_SI.tSupply);
    expect(hReturn).toBe(WEATHER_DESIGN_SI.hReturn);
    expect(tHighLimit).toBe(WEATHER_DESIGN_SI.tHighLimit);
  });

  it('counts envelope hours against the bounds as published', async () => {
    await analyse({ ...BASE, isSi: false });

    const [, tMin, tMax] = countHoursInside.mock.calls[0]!;
    // TC 9.9 Recommended is 18–27 °C. Read as °F it becomes −8 to −3 °C, and
    // the answer comes back as zero hours for every climate on earth.
    expect(tMin).toBe(18);
    expect(tMax).toBe(27);
  });

  it('converts the bin width, which is the one input the reader types', async () => {
    await analyse({ ...BASE, isSi: true });
    expect(binWeatherData.mock.calls[0]![1]).toBeCloseTo(1, 12);

    binWeatherData.mockClear();
    await analyse({ ...BASE, isSi: false, token: 2 });
    // A width is a difference, so it scales and does not offset: 1 °F of bin
    // width is 5/9 K, not −17 K.
    expect(binWeatherData.mock.calls[0]![1]).toBeCloseTo(5 / 9, 12);
  });

  it('reports bins in °C, which is what the chart lattice is drawn over', async () => {
    const reply = (await analyse({ ...BASE, isSi: false })) as {
      result: { bins: { tMin: number; tStep: number } };
    };
    // `chart_lattice` is pure geometry over °C; handing it °F put every cell of
    // the heatmap in the wrong place.
    expect(reply.result.bins.tMin).toBe(-5);
    expect(reply.result.bins.tStep).toBe(1);
  });
});
