/**
 * The Process Design page: the AHU train, the cycle results, and the coil
 * inspector.
 *
 * Built from HTML rather than canvas. A schematic is boxes with text in them —
 * the browser already lays that out, makes it selectable, and reads it to a
 * screen reader, and reimplementing those three things on a canvas to draw
 * eight rectangles is the wrong trade.
 *
 * **Blocks not in the active cycle render as inactive rather than disappearing**
 * (`DEVELOPMENT_PLAN.md` Phase 8). A palette that hides what is not running
 * teaches that the tool cannot do it; one that greys it out teaches that this
 * design does not use it, which is the true statement.
 */

import { Icon, type IconName } from '../shell/Icon';
import { useT, type Translator } from '../i18n/useT';
import type { TranslationKey } from '../i18n';
import type { CycleOutput, StatePointOutput } from '../psychro';
import { UnitField } from '../shell/UnitField';
import { specificVolumeSi } from '../units';
import type { DimensionId } from '../units';

/** One block in the air-handling train. */
interface Block {
  key: string;
  icon: IconName;
  title: TranslationKey;
  /** The state-point label the air carries when it leaves this block. */
  node?: string;
}

/** The train, in the order the air takes. */
const TRAIN: Block[] = [
  { key: 'outdoor', icon: 'open', title: 'design.blockOutdoor', node: 'OA' },
  { key: 'recovery', icon: 'process', title: 'design.blockRecovery' },
  { key: 'mixing', icon: 'shape', title: 'design.blockMixing', node: 'MA' },
  { key: 'preheat', icon: 'sun', title: 'design.blockPreheat' },
  { key: 'cooling', icon: 'point', title: 'design.blockCooling', node: 'CL' },
  { key: 'reheat', icon: 'sun', title: 'design.blockReheat' },
  { key: 'fan', icon: 'fit', title: 'design.blockFan', node: 'SA' },
];

/**
 * Which blocks the primary return-air cycle actually runs.
 *
 * The supply fan is *not* one of them. It is a real sensible heating process —
 * §4.7 is explicit that fan heat is not zero — but this macro does not model it,
 * and showing it active with no temperature rise would claim otherwise.
 */
const ACTIVE = new Set(['outdoor', 'mixing', 'cooling']);

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
}

/** A short state summary for a block's subtitle. */
function summarise(state: StatePointOutput | null, isSi: boolean, t: Translator): string {
  if (!state) return t('design.notInCycle');
  return `${state.dbt.toFixed(1)} ${t(isSi ? 'unit.celsius' : 'unit.fahrenheit')} · ${state.rh.toFixed(0)}%`;
}

export function ProcessDesignPage({
  design,
  onChange,
  cycle,
  error,
  isSi,
  onSendToChart,
  sent,
}: ProcessDesignPageProps) {
  const t = useT();
  const power = t(isSi ? 'unit.kilowatt' : 'unit.btuPerHour');
  const temp = t(isSi ? 'unit.celsius' : 'unit.fahrenheit');
  const flow = t(isSi ? 'unit.kgPerSecond' : 'unit.lbPerHour');
  const volume = t(isSi ? 'unit.m3PerSecond' : 'unit.cfm');

  /** The state each block leaves the air in, once the cycle is solved. */
  const stateFor: Record<string, StatePointOutput | null> = {
    // The outdoor block's state is the design case itself, not something the
    // cycle produces — it is the boundary condition everything else follows
    // from, and showing it as "not in cycle" was simply wrong.
    outdoor: null,
    mixing: cycle?.mixed ?? null,
    cooling: cycle?.coil.leaving ?? null,
    fan: cycle?.supply ?? null,
  };

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
          <ol className="train">
            {TRAIN.map((block) => {
              const active = ACTIVE.has(block.key);
              return (
                <li
                  key={block.key}
                  className={active ? 'block' : 'block block--inactive'}
                  aria-disabled={!active}
                >
                  <Icon name={block.icon} size={20} />
                  <span className="block__title">{t(block.title)}</span>
                  <span className="block__sub">
                    {!active
                      ? t('design.notInCycle')
                      : block.key === 'outdoor'
                        ? `${design.outdoorT.toFixed(1)} ${temp} · ${design.outdoorRh.toFixed(0)}%`
                        : summarise(stateFor[block.key] ?? null, isSi, t)}
                  </span>
                  {/* Only a block the cycle runs carries a state-point badge:
                      an SA tag on an inactive supply fan claims a state that
                      does not exist. */}
                  {active && block.node ? (
                    <span className="block__node">{block.node}</span>
                  ) : null}
                </li>
              );
            })}
            <li className="block block--room">
              <Icon name="shape" size={20} />
              <span className="block__title">{t('design.blockRoom')}</span>
              <span className="block__sub">
                {design.roomT.toFixed(1)} {temp} · {design.roomRh.toFixed(0)}%
              </span>
              <span className="block__node">RA</span>
            </li>
          </ol>

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
