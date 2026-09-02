/**
 * The weather page: load a year, bin it, and count what it means.
 *
 * Bring-your-own-data, and nothing is fetched. §5 gives two reasons and both
 * hold: hosting global weather is not viable for an open-source project, and
 * parsing locally keeps a user's project on their machine.
 *
 * The hour counts are the point of the page. A heatmap shows where a climate
 * sits; the counts say what that costs — and they are a *breakdown*, mutually
 * exclusive and summing to the year, rather than four independent tallies that
 * would add up to more hours than exist.
 */

import { useCallback, useRef, useState } from 'react';

import { useT } from '../i18n/useT';
import { envelopeById } from '../data';
import type { TranslationKey } from '../i18n';
import type { WeatherResult } from '../weather/epw.worker';
import { UnitField } from '../shell/UnitField';

/** What the page needs. */
export interface WeatherPageProps {
  /** The analysed year, or null. Every number in it came from the worker. */
  result: WeatherResult | null;
  /** Whether a parse is in flight. */
  loading: boolean;
  /** Why the last load failed. */
  error: string | null;
  /** Accepts a dropped or chosen file. */
  onFile: (file: File) => void;
  /** Bin increments. */
  binStepT: number;
  binStepW: number;
  onBinStepT: (step: number) => void;
  onBinStepW: (step: number) => void;
  /** Whether the document is in SI, for the binning-field labels. */
  isSi: boolean;
}

export function WeatherPage({
  result,
  loading,
  error,
  onFile,
  binStepT,
  binStepW,
  onBinStepT,
  onBinStepW,
  isSi,
}: WeatherPageProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  // Nothing is computed here. The worker resolved the year, binned it and
  // counted the hours; this page reads numbers.
  const counts = result?.freeCooling ?? null;
  const insideCounts = (result?.insideEnvelopes ?? []).map((e) => ({
    ...e,
    name: envelopeById(e.id)?.name ?? e.id,
  }));

  return (
    <main className="page" aria-label={t('page.weather')}>
      <div className="page__main">
        <section className="schematic">
          <div
            className={dragging ? 'dropzone dropzone--over' : 'dropzone'}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              accept(e.dataTransfer.files);
            }}
          >
            <p className="dropzone__title">{t('weather.drop')}</p>
            <p className="dropzone__hint">{t('weather.privacy')}</p>
            <button
              type="button"
              className="btn btn--block"
              onClick={() => input.current?.click()}
            >
              {t('weather.choose')}
            </button>
            <input
              ref={input}
              type="file"
              accept=".epw,.csv,text/csv"
              className="dropzone__input"
              aria-label={t('weather.choose')}
              onChange={(e) => accept(e.target.files)}
            />
          </div>

          {loading ? <p className="panel__empty">{t('weather.parsing')}</p> : null}
          {error ? (
            <p className="panel__error" role="alert">
              {error}
            </p>
          ) : null}

          {result ? (
            <>
              <dl className="results" aria-label={t('weather.summary')}>
                {[
                  ['weather.station', result.location, ''],
                  ['weather.hours', String(result.hours), ''],
                  ['weather.elevation', result.elevationM.toFixed(0), t('unit.metre')],
                  ['weather.rejected', String(result.rejected + result.skipped), ''],
                ].map(([key, value, unit]) => (
                  <div className="results__cell" key={key}>
                    <dt>{t(key as TranslationKey)}</dt>
                    <dd>
                      {value}
                      <span className="results__unit">{unit}</span>
                    </dd>
                  </div>
                ))}
              </dl>

              {counts ? (
                <dl className="results" aria-label={t('weather.freeCooling')}>
                  {[
                    ['weather.economizer', counts.economizer],
                    ['weather.evaporative', counts.evaporative],
                    ['weather.mechanical', counts.mechanical],
                    ['weather.heating', counts.heating],
                  ].map(([key, value]) => (
                    <div className="results__cell" key={key as string}>
                      <dt>{t(key as TranslationKey)}</dt>
                      <dd>
                        {value as number}
                        <span className="results__unit">{t('weather.hoursUnit')}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {insideCounts.length > 0 ? (
                <dl className="results" aria-label={t('weather.insideEnvelopes')}>
                  {insideCounts.map((e) => (
                    <div className="results__cell" key={e.id}>
                      <dt>{e.name}</dt>
                      <dd>
                        {e.hours}
                        <span className="results__unit">{t('weather.hoursUnit')}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              <p className="panel__note">{t('weather.exclusiveNote')}</p>
            </>
          ) : null}
        </section>
      </div>

      <aside className="panel" aria-label={t('weather.binning')}>
        <div className="panel__header">
          <span className="panel__title">{t('weather.binning')}</span>
        </div>
        <div className="panel__fields">
          {/* A bin width is a temperature *difference*, so it scales rather
              than offsets: 1 °C of width is 1.8 °F of width, not 33.8. */}
          <UnitField
            label={t('weather.binStepT')}
            dimension="temperatureDelta"
            isSi={isSi}
            value={binStepT}
            onCommit={onBinStepT}
          />
          <UnitField
            label={t('weather.binStepW')}
            dimension="humidityRatio"
            isSi={isSi}
            value={binStepW}
            onCommit={onBinStepW}
          />
          <p className="panel__note">{t('weather.binNote')}</p>
        </div>
      </aside>
    </main>
  );
}
