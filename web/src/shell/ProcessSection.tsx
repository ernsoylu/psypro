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
import { useT, type Translator } from '../i18n/useT';
import type { TranslationKey } from '../i18n';
import type { Process, ProcessKind } from '../store/useProcessStore';
import type { StatePoint } from '../store/usePsychStore';
import type { ResolvedProcess } from '../store/useResolvedProcesses';

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

/** One editable number. */
interface Field {
  key: keyof Process;
  label: TranslationKey;
  unit?: string;
  step?: number;
}

/** The fields each kind exposes, and nothing it does not use. */
function fieldsFor(kind: ProcessKind, isSi: boolean, t: Translator): Field[] {
  const temp = t(isSi ? 'unit.celsius' : 'unit.fahrenheit');
  const flow = t(isSi ? 'unit.kgPerSecond' : 'unit.lbPerHour');
  const power = t(isSi ? 'unit.kilowatt' : 'unit.btuPerHour');
  const enthalpy = t(isSi ? 'unit.kjPerKg' : 'unit.btuPerLb');
  const mdot: Field = { key: 'mdot', label: 'process.massFlow', unit: flow };

  switch (kind) {
    case 'sensible':
      return [mdot, { key: 'targetT', label: 'process.targetT', unit: temp }];
    case 'sensibleDuty':
      return [mdot, { key: 'duty', label: 'process.duty', unit: power }];
    case 'steam':
      return [
        mdot,
        {
          key: 'targetW',
          label: 'process.targetW',
          unit: t('unit.kgPerKg'),
          step: 0.001,
        },
        { key: 'steamEnthalpy', label: 'process.steamEnthalpy', unit: enthalpy },
      ];
    case 'evaporative':
      return [mdot, { key: 'effectiveness', label: 'process.effectiveness', step: 0.01 }];
    case 'recovery':
      return [
        mdot,
        { key: 'epsSensible', label: 'process.epsSensible', step: 0.01 },
        { key: 'epsLatent', label: 'process.epsLatent', step: 0.01 },
      ];
    case 'mix':
      return [
        { key: 'mdot', label: 'process.massFlowA', unit: flow },
        { key: 'mdotSecond', label: 'process.massFlowB', unit: flow },
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

            {fieldsFor(process.kind, isSi, t).map((field) => (
              <label className="field" key={field.key}>
                <span className="field__label">
                  {t(field.label)}
                  {field.unit ? <span className="field__unit">{field.unit}</span> : null}
                </span>
                <input
                  className="field__input"
                  value={String(process[field.key] ?? '')}
                  inputMode="decimal"
                  onChange={(e) => onChange({ [field.key]: Number(e.target.value) })}
                />
              </label>
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
