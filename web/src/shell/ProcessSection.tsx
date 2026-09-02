/**
 * The process editor and its load readout.
 *
 * The readout is the reason the panel exists. A process drawn on a chart tells
 * you a *direction*; the numbers beside it tell you what it costs, and those two
 * have to come from the same calculation or the tool is worse than a printed
 * chart with a ruler.
 *
 * Sensible and latent are shown side by side with the ratio between them,
 * because SHR is what a designer selects equipment against and it is also the
 * angle drawn on the chart — the protractor line and this number are the same
 * fact in two forms.
 */

import { Icon } from './Icon';
import { useT } from '../i18n/useT';
import type { DimensionId } from '../units';
import type { TranslationKey } from '../i18n';
import type { Process, ProcessKind } from '../store/useProcessStore';
import type { StatePoint } from '../store/usePsychStore';
import type { ResolvedProcess } from '../store/useResolvedProcesses';
import { UnitField } from './UnitField';

/** The process kinds a user can add, in the order §4.1 introduces them. */
export const PROCESS_KINDS = [
  ['sensible', 'process.sensible'],
  ['sensibleDuty', 'process.sensibleDuty'],
  ['steam', 'process.steam'],
  ['evaporative', 'process.evaporative'],
  ['recovery', 'process.recovery'],
  ['mix', 'process.mix'],
  ['link', 'process.link'],
] as const satisfies readonly (readonly [ProcessKind, TranslationKey])[];

/** Which kinds need a second point, and what that point is. */
const NEEDS_SECOND: Partial<Record<ProcessKind, TranslationKey>> = {
  mix: 'process.secondStream',
  recovery: 'process.exhaustStream',
  link: 'process.targetPoint',
};

/** One editable number, and what kind of quantity it is. */
interface Field {
  key: keyof Process;
  label: TranslationKey;
  dimension: DimensionId;
}

/**
 * The fields each kind exposes, and nothing it does not use.
 *
 * A flow field carries the `flow` dimension rather than a mass unit, which is
 * what lets it be typed as m³/h or cfm against the inlet's specific volume —
 * `ṁ = V̇ / v_da`, the dry-air basis §3.2 insists on.
 */
function fieldsFor(kind: ProcessKind): Field[] {
  const mdot: Field = { key: 'mdot', label: 'process.massFlow', dimension: 'flow' };

  switch (kind) {
    case 'sensible':
      return [mdot, { key: 'targetT', label: 'process.targetT', dimension: 'temperature' }];
    case 'sensibleDuty':
      return [mdot, { key: 'duty', label: 'process.duty', dimension: 'power' }];
    case 'steam':
      return [
        mdot,
        { key: 'targetW', label: 'process.targetW', dimension: 'humidityRatio' },
        {
          key: 'steamEnthalpy',
          label: 'process.steamEnthalpy',
          dimension: 'enthalpy',
        },
      ];
    case 'evaporative':
      return [
        mdot,
        { key: 'effectiveness', label: 'process.effectiveness', dimension: 'ratio' },
      ];
    case 'recovery':
      return [
        mdot,
        { key: 'epsSensible', label: 'process.epsSensible', dimension: 'ratio' },
        { key: 'epsLatent', label: 'process.epsLatent', dimension: 'ratio' },
      ];
    case 'mix':
      return [
        { key: 'mdot', label: 'process.massFlowA', dimension: 'flow' },
        { key: 'mdotSecond', label: 'process.massFlowB', dimension: 'flow' },
      ];
    case 'link':
      return [mdot];
  }
}

/** What the section needs. */
export interface ProcessSectionProps {
  /** The process being edited, or null. */
  process: Process | null;
  /** Its resolved outlet and load. */
  resolved: ResolvedProcess | null;
  /** Every point, for the second-stream selector. */
  points: StatePoint[];
  /** Whether the document is in SI. */
  isSi: boolean;
  /**
   * The inlet's dry-air specific volume in m³/kg, or null when it has not
   * resolved. A volumetric flow entry is only offered where this exists.
   */
  inletSpecificVolume: number | null;
  /** Whether adding a process is possible — it needs a point to start from. */
  canAdd: boolean;
  /** Writes a change back to the store. */
  onChange: (patch: Partial<Process>) => void;
  /** Adds a process of the given kind. */
  onAdd: (kind: ProcessKind) => void;
  /** Deletes the selected process. */
  onRemove: () => void;
}

export function ProcessSection({
  process,
  resolved,
  points,
  isSi,
  inletSpecificVolume,
  canAdd,
  onChange,
  onAdd,
  onRemove,
}: ProcessSectionProps) {
  const t = useT();

  return (
    <>
      <h2 className="panel__section panel__section--split">
        {t('panel.sectionProcess')}
        <select
          className="select select--compact"
          value=""
          disabled={!canAdd}
          aria-label={t('process.add')}
          onChange={(e) => e.target.value && onAdd(e.target.value as ProcessKind)}
        >
          <option value="">{t('process.add')}</option>
          {PROCESS_KINDS.map(([kind, key]) => (
            <option key={kind} value={kind}>
              {t(key)}
            </option>
          ))}
        </select>
      </h2>

      {!process ? (
        <p className="panel__empty">
          {canAdd ? t('process.emptyHint') : t('process.needsPointHint')}
        </p>
      ) : (
        <>
          <div className="panel__fields">
            <div className="field field--row">
              <span className="field__label">
                {t(
                  PROCESS_KINDS.find(([k]) => k === process.kind)?.[1] ??
                    'process.sensible',
                )}
              </span>
              <button
                type="button"
                className="btn btn--icon"
                aria-label={t('process.remove')}
                onClick={onRemove}
              >
                <Icon name="trash" />
              </button>
            </div>

            {NEEDS_SECOND[process.kind] ? (
              <label className="field">
                <span className="field__label">{t(NEEDS_SECOND[process.kind]!)}</span>
                <select
                  className="field__input"
                  value={process.secondId ?? ''}
                  onChange={(e) => onChange({ secondId: e.target.value || null })}
                >
                  <option value="">{t('process.choosePoint')}</option>
                  {points
                    .filter((p) => p.id !== process.fromId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}

            {fieldsFor(process.kind).map((field) => (
              <UnitField
                key={field.key}
                label={t(field.label)}
                dimension={field.dimension}
                isSi={isSi}
                value={(process[field.key] as number | undefined) ?? 0}
                vDaSi={inletSpecificVolume}
                onCommit={(value) => onChange({ [field.key]: value })}
              />
            ))}
          </div>

          {resolved?.error ? (
            <p className="panel__error" role="alert">
              {resolved.error}
            </p>
          ) : null}

          {resolved?.nearSaturation ? (
            <p className="panel__warning">{t('process.nearSaturation')}</p>
          ) : null}

          {resolved?.fogged ? (
            <p className="panel__warning">
              {t('process.fogged', {
                condensate: resolved.condensate.toFixed(5),
                unit: t(isSi ? 'unit.kgPerSecond' : 'unit.lbPerHour'),
              })}
            </p>
          ) : null}

          {resolved?.load ? (
            <table className="readout">
              <tbody>
                {[
                  ['process.loadTotal', resolved.load.total],
                  ['process.loadSensible', resolved.load.sensible],
                  ['process.loadLatent', resolved.load.latent],
                ].map(([key, value]) => (
                  <tr key={key as string}>
                    <th scope="row" className="readout__label">
                      {t(key as TranslationKey)}
                    </th>
                    <td className="readout__value">{(value as number).toFixed(3)}</td>
                    <td className="readout__unit">
                      {t(isSi ? 'unit.kilowatt' : 'unit.btuPerHour')}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="readout__label">
                    {t('process.moisture')}
                  </th>
                  <td className="readout__value">{resolved.load.moisture.toFixed(6)}</td>
                  <td className="readout__unit">
                    {t(isSi ? 'unit.kgPerSecond' : 'unit.lbPerHour')}
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="readout__label">
                    {t('process.shr')}
                  </th>
                  <td className="readout__value">
                    {/* A ratio of zero to zero is not zero. A process that moves
                        no energy has no sensible heat ratio, and printing 0.000
                        would be a number a reader would act on. */}
                    {resolved.load.has_shr
                      ? resolved.load.shr.toFixed(3)
                      : t('process.noShr')}
                  </td>
                  <td className="readout__unit" />
                </tr>
              </tbody>
            </table>
          ) : null}
        </>
      )}
    </>
  );
}
