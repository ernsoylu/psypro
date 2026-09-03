/**
 * The Process Design page: the circuit, and the load case that starts one.
 *
 * It used to draw seven fixed blocks in a row and grey out the ones the macro
 * did not run — a picture of *one* cycle, and read-only. It is now an editor:
 * blocks are placed and wired into whatever circuit the plant actually is, and
 * every block is a process on the chart while every wire is a state point. The
 * two pages are two views of one document, so editing either edits both.
 *
 * The eight-field design case stays, and stays first, because it is the fastest
 * path there is from a room load to a sized system — and it now *materialises a
 * circuit* rather than printing a strip of numbers. Retiring it would have cost
 * the one-action route from loads to a design and the §4.9 derivation with it.
 */

import type { ReactNode } from 'react';

import { useT } from '../i18n/useT';
import type { TranslationKey } from '../i18n';
import type { CycleOutput } from '../psychro';
import { UnitField } from '../shell/UnitField';
import { specificVolumeSi } from '../units';
import type { DimensionId } from '../units';

/** What the page needs. */
export interface ProcessDesignPageProps {
  /** The design case, as typed. */
  design: {
    outdoorT: number;
    outdoorRh: number;
    roomT: number;
    roomRh: number;
    qSensible: number;
    qLatent: number;
    supplyT: number;
    outdoorFraction: number;
  };
  /** Writes a change back to the store. */
  onChange: (patch: Partial<ProcessDesignPageProps['design']>) => void;
  /** The solved cycle, or null while it cannot be solved. */
  cycle: CycleOutput | null;
  /** Why it could not be solved, if it could not. */
  error: string | null;
  /** Whether the document is in SI. */
  isSi: boolean;
  /**
   * Puts the solved cycle into the document as points and processes.
   *
   * The one crossing this page has ever had. Without it the macro's answer
   * lives and dies in the results strip: the chart never draws it and no part
   * of it can be edited.
   */
  onSendToChart: () => void;
  /** Whether the cycle has been sent, so the page can say so. */
  sent: boolean;
  /** The circuit editor itself. */
  canvas: ReactNode;
  /** The block palette, above the case. */
  palette: ReactNode;
}

export function ProcessDesignPage({
  design,
  onChange,
  cycle,
  error,
  isSi,
  onSendToChart,
  sent,
  canvas,
  palette,
}: ProcessDesignPageProps) {
  const t = useT();
  const power = t(isSi ? 'unit.kilowatt' : 'unit.btuPerHour');
  const temp = t(isSi ? 'unit.celsius' : 'unit.fahrenheit');
  const flow = t(isSi ? 'unit.kgPerSecond' : 'unit.lbPerHour');
  const volume = t(isSi ? 'unit.m3PerSecond' : 'unit.cfm');

  const inputs: {
    key: keyof ProcessDesignPageProps['design'];
    label: TranslationKey;
    dimension: DimensionId;
  }[] = [
    { key: 'outdoorT', label: 'design.outdoorT', dimension: 'temperature' },
    { key: 'outdoorRh', label: 'design.outdoorRh', dimension: 'percent' },
    { key: 'roomT', label: 'design.roomT', dimension: 'temperature' },
    { key: 'roomRh', label: 'design.roomRh', dimension: 'percent' },
    { key: 'qSensible', label: 'design.qSensible', dimension: 'power' },
    { key: 'qLatent', label: 'design.qLatent', dimension: 'power' },
    { key: 'supplyT', label: 'design.supplyT', dimension: 'temperature' },
    { key: 'outdoorFraction', label: 'design.outdoorFraction', dimension: 'ratio' },
  ];

  return (
    <main className="page" aria-label={t('page.processDesign')}>
      <div className="page__main">
        <section className="schematic" aria-label={t('design.schematic')}>
          {canvas}

          {error ? (
            <p className="panel__error" role="alert">
              {error}
            </p>
          ) : null}

          {cycle ? (
            <dl className="results" aria-label={t('design.results')}>
              {[
                ['design.coilLoad', cycle.coil.total_load.toFixed(2), power],
                [
                  'design.coilSensible',
                  (cycle.coil.total_load * cycle.coil.shr).toFixed(2),
                  power,
                ],
                ['design.condensate', cycle.coil.condensate.toFixed(5), flow],
                ['design.supplyFlow', cycle.design.volumetric_flow.toFixed(3), volume],
                ['design.massFlow', cycle.mdot_supply.toFixed(3), flow],
                ['design.rshf', cycle.design.rshf.toFixed(3), ''],
              ].map(([key, value, unit]) => (
                <div className="results__cell" key={key as string}>
                  <dt>{t(key as TranslationKey)}</dt>
                  <dd>
                    {value}
                    <span className="results__unit">{unit}</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {cycle?.mixing_fogged ? (
            <p className="panel__warning">{t('design.mixingFogged')}</p>
          ) : null}

          {cycle ? (
            <>
              <button type="button" className="btn btn--block" onClick={onSendToChart}>
                {t('design.sendToChart')}
              </button>
              <p className="panel__note">
                {sent ? t('design.sentToChart') : t('design.sendToChartHint')}
              </p>
            </>
          ) : null}
        </section>
      </div>

      <aside className="panel" aria-label={t('design.inspector')}>
        <div className="panel__header">
          <span className="panel__title">{t('design.inspector')}</span>
        </div>

        {palette}

        <h2 className="panel__section">{t('design.sectionCase')}</h2>
        <div className="panel__fields">
          {inputs.map((field) => (
            <UnitField
              key={field.key}
              label={t(field.label)}
              dimension={field.dimension}
              isSi={isSi}
              value={design[field.key]}
              // The supply air's own specific volume, so a designer may state
              // the case in m³/h or cfm as readily as in kg/s.
              vDaSi={specificVolumeSi(cycle?.supply.specific_volume ?? null, isSi)}
              onCommit={(value) => onChange({ [field.key]: value })}
            />
          ))}
        </div>

        {cycle ? (
          <>
            <h2 className="panel__section">{t('design.sectionCoil')}</h2>
            <table className="readout">
              <tbody>
                <tr>
                  <th scope="row" className="readout__label">
                    {t('design.adp')}
                  </th>
                  <td className="readout__value">{cycle.coil.adp.dbt.toFixed(2)}</td>
                  <td className="readout__unit">{temp}</td>
                </tr>
                {/* All three forms, so a result can be checked against whichever
                    one the reader's reference uses. They agree because the
                    leaving state lies on the line to the ADP — which is the
                    construction, not a coincidence. */}
                {[
                  ['design.bfTemperature', cycle.coil.bf_temperature],
                  ['design.bfHumidityRatio', cycle.coil.bf_humidity_ratio],
                  ['design.bfEnthalpy', cycle.coil.bf_enthalpy],
                  ['design.coilShr', cycle.coil.shr],
                ].map(([key, value]) => (
                  <tr key={key as string}>
                    <th scope="row" className="readout__label">
                      {t(key as TranslationKey)}
                    </th>
                    <td className="readout__value">{(value as number).toFixed(4)}</td>
                    <td className="readout__unit" />
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="readout__label">
                    {t('design.airSideLoad')}
                  </th>
                  <td className="readout__value">
                    {cycle.coil.air_side_load.toFixed(2)}
                  </td>
                  <td className="readout__unit">{power}</td>
                </tr>
                <tr>
                  <th scope="row" className="readout__label">
                    {t('design.totalLoad')}
                  </th>
                  <td className="readout__value">{cycle.coil.total_load.toFixed(2)}</td>
                  <td className="readout__unit">{power}</td>
                </tr>
              </tbody>
            </table>
            <p className="panel__note">{t('design.bfNote')}</p>
          </>
        ) : null}
      </aside>
    </main>
  );
}
