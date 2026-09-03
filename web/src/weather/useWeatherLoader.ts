/**
 * Drives the weather worker.
 *
 * The worker owns the file, the engine, and every analysis; this side owns a
 * request token and the result. That split is what keeps the main thread free —
 * a trace on the first version, where the analysis ran here, measured 39 seconds
 * of blocked page on one 8760-hour file.
 *
 * Every request carries a token and a reply whose token has moved on is dropped.
 * That is the difference between "I loaded Chicago then Denver" showing Denver
 * and showing whichever finished last.
 */

import { useCallback, useEffect, useRef } from 'react';

import { useWeatherStore } from '../store/useWeatherStore';
import type { EnvelopeBounds, WeatherRequest, WeatherResponse } from './epw.worker';

/** Everything an analysis depends on besides the file itself. */
export interface WeatherContext {
  /** Site elevation in metres — the worker analyses in SI throughout. */
  altitudeM: number;
  /** Whether the document is in SI. Only the bin width is expressed that way. */
  isSi: boolean;
  binStepT: number;
  binStepW: number;
  design: WeatherRequest['design'];
  envelopes: { id: string; bounds: EnvelopeBounds }[];
}

/** Loads a file, and re-runs the analysis when the context changes. */
export function useWeatherLoader(context: WeatherContext): {
  load: (file: File) => void;
  reanalyse: () => void;
} {
  const worker = useRef<Worker | null>(null);
  const token = useRef(0);
  const { setResult, setLoading, setError, hasFile } = useWeatherStore();

  // The context is read at send time rather than captured, so a re-analysis
  // triggered by a store change uses the latest values without rebuilding the
  // callback — and rebuilding it would tear down and re-create the worker.
  //
  // Written in an effect rather than during render: a ref mutated while
  // rendering is a hazard under concurrent React, where a render can be thrown
  // away after it has already changed something outside itself. This effect is
  // declared before the caller's own, so the value is current by the time a
  // re-analysis fires.
  const latest = useRef(context);
  useEffect(() => {
    latest.current = context;
  });

  useEffect(() => {
    return () => {
      worker.current?.terminate();
      worker.current = null;
    };
  }, []);

  const send = useCallback(
    (text: string | undefined) => {
      worker.current ??= new Worker(new URL('./epw.worker.ts', import.meta.url), {
        type: 'module',
      });
      const w = worker.current;
      const mine = (token.current += 1);
      const c = latest.current;

      w.onmessage = (event: MessageEvent<WeatherResponse>) => {
        if (event.data.token !== mine) return;
        if (event.data.ok) setResult(event.data.result);
        else setError(event.data.error);
      };
      w.onerror = () => setError('the weather worker failed');

      setLoading(true);
      const request: WeatherRequest = {
        token: mine,
        altitudeM: c.altitudeM,
        isSi: c.isSi,
        binStepT: c.binStepT,
        binStepW: c.binStepW,
        design: c.design,
        envelopes: c.envelopes,
      };
      if (text !== undefined) request.text = text;
      w.postMessage(request);
    },
    [setResult, setLoading, setError],
  );

  const load = useCallback(
    (file: File) => {
      setLoading(true);
      // Only the parse goes to the worker: a File cannot be transferred, and
      // its text has to exist before it can be sent.
      file
        .text()
        .then((text) => send(text))
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    },
    [send, setLoading, setError],
  );

  const reanalyse = useCallback(() => {
    // Nothing to re-analyse until a file has been loaded; the worker keeps the
    // parsed arrays, so this does not re-read a megabyte of text.
    if (hasFile) send(undefined);
  }, [send, hasFile]);

  return { load, reanalyse };
}
