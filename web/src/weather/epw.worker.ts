/**
 * The weather worker: parse, resolve, bin, and count — all off the main thread.
 *
 * The worker started out as a parser only, because an 8760-row EPW is about a
 * megabyte of text and splitting it on the main thread is a visible freeze.
 *
 * A browser trace then showed the parse was never the expensive part. Resolving
 * the year's properties was: **39 seconds of blocked main thread**, cut to 2.3
 * by resolving once instead of per question, and still 2.3 seconds of frozen
 * page. So the engine moved in here too. The worker now owns its own WASM
 * instance and the main thread receives plain numbers.
 *
 * That is also why the *analysis* happens here rather than being exposed as a
 * handle: a handle would have to live in whichever thread owns the wasm memory,
 * and every question asked of it would be a call into that thread anyway.
 */

import initEngine, {
  bin_weather_data,
  count_free_cooling_hours,
  count_hours_inside,
  resolve_weather,
} from '../wasm/psychro';
import { parseEpw } from './epw';

/** An envelope's eight bounds, as the main thread holds them. */
export type EnvelopeBounds = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** What the main thread sends. */
export interface WeatherRequest {
  /** The file's text, on a first load. Omitted when only the bins change. */
  text?: string;
  /** Echoed back, so a stale reply from an earlier file can be discarded. */
  token: number;
  /** Site elevation, as the document expresses it. */
  altitude: number;
  /** Whether the document is in SI. */
  isSi: boolean;
  /** Dry-bulb bin increment. */
  binStepT: number;
  /** Humidity-ratio bin increment. */
  binStepW: number;
  /** The free-cooling design the hour counts are taken against. */
  design: {
    tSupply: number;
    hReturn: number;
    tHighLimit: number;
    evaporative: number;
  };
  /** Envelopes to count hours inside, by id. */
  envelopes: { id: string; bounds: EnvelopeBounds }[];
}

/** The binned grid, as plain transferable arrays. */
export interface BinGrid {
  tMin: number;
  wMin: number;
  tStep: number;
  wStep: number;
  tCount: number;
  wCount: number;
  counts: Uint32Array;
  peak: number;
}

/** Everything the worker knows about the loaded year. */
export interface WeatherResult {
  location: string;
  elevationM: number;
  hours: number;
  rejected: number;
  skipped: number;
  bins: BinGrid;
  freeCooling: {
    economizer: number;
    evaporative: number;
    mechanical: number;
    heating: number;
    skipped: number;
  };
  insideEnvelopes: { id: string; hours: number }[];
}

/** What comes back. */
export type WeatherResponse =
  | { ok: true; token: number; result: WeatherResult }
  | { ok: false; token: number; error: string };

/**
 * The worker's own global, typed.
 *
 * `tsconfig` uses the DOM lib, so bare `self` is typed as a `Window` and its
 * `postMessage` takes a target origin rather than a transfer list. Adding the
 * WebWorker lib would collide with DOM across the rest of the app for the sake
 * of one file, so this narrows it here instead.
 */
const ctx = self as unknown as Worker;

/** The engine, initialised once for the worker's life. */
let engine: Promise<unknown> | null = null;

/**
 * The parsed year, kept between messages.
 *
 * Re-binning at a different increment must not re-read the file: the text is a
 * megabyte and the arrays are already here.
 */
let parsed: ReturnType<typeof parseEpw> | null = null;

/** Runs the full analysis on the currently parsed year. */
function analyse(request: WeatherRequest): WeatherResult {
  if (!parsed) throw new Error('no weather file has been loaded');

  // Resolved once. Every question below is then a scan over plain numbers,
  // which is what took the main-thread block from 39 seconds to nothing.
  const year = resolve_weather(
    parsed.dryBulb,
    parsed.dewPoint,
    request.altitude,
    request.isSi,
  );
  try {
    const b = bin_weather_data(year, request.binStepT, request.binStepW);
    const grid: BinGrid = {
      tMin: b.t_min,
      wMin: b.w_min,
      tStep: b.t_step,
      wStep: b.w_step,
      tCount: b.t_count,
      wCount: b.w_count,
      counts: Uint32Array.from(b.counts),
      peak: b.peak,
    };
    b.free();

    const fc = count_free_cooling_hours(
      year,
      request.design.tSupply,
      request.design.hReturn,
      request.design.tHighLimit,
      request.design.evaporative,
    );

    const insideEnvelopes = request.envelopes.map((e) => ({
      id: e.id,
      hours: count_hours_inside(year, ...e.bounds),
    }));

    return {
      location: parsed.location,
      elevationM: parsed.elevationM,
      hours: parsed.hours,
      rejected: parsed.rejected,
      skipped: year.skipped,
      bins: grid,
      freeCooling: {
        economizer: fc.economizer,
        evaporative: fc.evaporative,
        mechanical: fc.mechanical,
        heating: fc.heating,
        skipped: fc.skipped,
      },
      insideEnvelopes,
    };
  } finally {
    // The handle owns wasm memory; a re-bin per keystroke would otherwise leak
    // a year each time.
    year.free();
  }
}

ctx.onmessage = async (event: MessageEvent<WeatherRequest>) => {
  const request = event.data;
  try {
    engine ??= initEngine();
    await engine;
    if (request.text !== undefined) parsed = parseEpw(request.text);
    const result = analyse(request);
    const response: WeatherResponse = { ok: true, token: request.token, result };
    // Transfer the counts rather than copying: a fine increment over a wide
    // climate is a few thousand cells, and it is already in a typed array.
    ctx.postMessage(response, [result.bins.counts.buffer]);
  } catch (e: unknown) {
    const response: WeatherResponse = {
      ok: false,
      token: request.token,
      error: e instanceof Error ? e.message : String(e),
    };
    ctx.postMessage(response);
  }
};
