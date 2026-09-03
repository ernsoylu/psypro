/**
 * The process editor, its load readout, and what the engine made of it.
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
 *
 * Three things here are new, and each answers a way the old panel misled:
 *
 * * **The endpoints are shown.** A process used to be silently bound to whatever
 *   point happened to be selected, with no field naming its inlet. Now the inlet
 *   and the outlet are both named, and the outlet is a real point you can select.
 * * **A wet coil says so.** A target below the entering dew point used to print
 *   the backend's supersaturation message. Now it prints the coil: how much water
 *   came out, where the apparatus dew point is, and the bypass factor in the
 *   three forms §4.2 asks for.
 * * **A line between two points is identified.** The engine names the process and
 *   backs out its defining parameters, and the panel offers to adopt them — which
 *   is what turns a fit from a read-only observation into a process you can edit.
 */

import { Icon } from './Icon';
import { useT, type Translator } from '../i18n/useT';
import type { DimensionId } from '../units';
import type { TranslationKey } from '../i18n';
import { ProcessFitKind, type ProcessFitOutput } from '../psychro';
import type { Process, ProcessKind } from '../store/useProcessStore';
import { needsSecondPoint } from '../store/useProcessStore';
import type { StatePoint } from '../store/usePsychStore';
import type { ResolvedProcess } from '../store/useResolvedProcesses';
import { UnitField } from './UnitField';

/** The process kinds a user can add, in the order §4.1 introduces them. */
export const PROCESS_KINDS = [
  ['sensible', 'process.sensible'],
  ['sensibleDuty', 'process.sensibleDuty'],
  ['cooling', 'process.cooling'],
  ['steam', 'process.steam'],
  ['evaporative', 'process.evaporative'],
  ['desiccant', 'process.desiccant'],
  ['recovery', 'process.recovery'],
  ['mix', 'process.mix'],
  ['link', 'process.link'],
] as const satisfies readonly (readonly [ProcessKind, TranslationKey])[];

/** Which kinds need a second point, and what that point is. */
const SECOND_LABEL: Partial<Record<ProcessKind, TranslationKey>> = {
  mix: 'process.secondStream',
  recovery: 'process.exhaustStream',
  link: 'process.targetPoint',
};

/** The name of each identified fit, for the readout. */
const FIT_LABEL: Record<ProcessFitKind, TranslationKey> = {
  [ProcessFitKind.SensibleHeating]: 'fit.sensibleHeating',
  [ProcessFitKind.SensibleCooling]: 'fit.sensibleCooling',
  [ProcessFitKind.Isothermal]: 'fit.isothermal',
  [ProcessFitKind.Evaporative]: 'fit.evaporative',
  [ProcessFitKind.CoolingDehumidification]: 'fit.coolingDehumidification',
  [ProcessFitKind.Desiccant]: 'fit.desiccant',
  [ProcessFitKind.General]: 'fit.general',
};

/**
 * The parametric process each fit can be adopted as.
 *
 * `General` and the wet-coil fit are absent on purpose. A general chord is not a
 * named process, so there is nothing to adopt; a wet coil *is* one, but its two
 * parameters — ADP and bypass factor — are recovered from the construction
 * rather than from the chord alone, so adopting it needs the coil in hand and is
 * offered through `cooling` once that is resolved.
 */
const ADOPTABLE: Partial<Record<ProcessFitKind, ProcessKind>> = {
  [ProcessFitKind.SensibleHeating]: 'sensible',
  [ProcessFitKind.SensibleCooling]: 'sensible',
  [ProcessFitKind.Isothermal]: 'steam',
  [ProcessFitKind.Evaporative]: 'evaporative',
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
  const bypass: Field = {
    key: 'bypassFactor',
    label: 'process.bypassFactor',
    dimension: 'ratio',
  };

  switch (kind) {
    case 'sensible':
      return [
        mdot,
        { key: 'targetT', label: 'process.targetT', dimension: 'temperature' },
        bypass,
      ];
    case 'sensibleDuty':
      return [mdot, { key: 'duty', label: 'process.duty', dimension: 'power' }, bypass];
    case 'cooling':
      return [
        mdot,
        { key: 'tAdp', label: 'process.tAdp', dimension: 'temperature' },
        bypass,
      ];
    case 'steam':
      return [
        mdot,
        { key: 'targetW', label: 'process.targetW', dimension: 'humidityRatio' },
        { key: 'steamEnthalpy', label: 'process.steamEnthalpy', dimension: 'enthalpy' },
      ];
    case 'evaporative':
      return [
        mdot,
        { key: 'effectiveness', label: 'process.effectiveness', dimension: 'ratio' },
      ];
    case 'desiccant':
      return [
        mdot,
        {
          key: 'wEquilibrium',
          label: 'process.wEquilibrium',
          dimension: 'humidityRatio',
        },
        { key: 'epsLatent', label: 'process.epsLatent', dimension: 'ratio' },
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

/** The rows a fit contributes, each already formatted. */
function fitRows(
  fit: ProcessFitOutput,
  isSi: boolean,
  t: Translator,
): { key: string; label: string; value: string; unit: string }[] {
  const rows: { key: string; label: string; value: string; unit: string }[] = [];
  const push = (key: TranslationKey, value: string, unit: string) =>
    rows.push({ key, label: t(key), value, unit });

  if (fit.has_duty) {
    push('fit.duty', fit.duty.toFixed(3), t(isSi ? 'unit.kilowatt' : 'unit.btuPerHour'));
  }
  if (fit.has_water_flow) {
    push(
      'fit.waterFlow',
      fit.water_flow.toFixed(6),
      t(isSi ? 'unit.kgPerSecond' : 'unit.lbPerHour'),
    );
  }
  if (fit.has_steam_enthalpy) {
    push(
      'fit.steamEnthalpy',
      fit.steam_enthalpy.toFixed(1),
      t(isSi ? 'unit.kjPerKg' : 'unit.btuPerLb'),
    );
  }
  if (fit.has_effectiveness) {
    push('fit.effectiveness', fit.effectiveness.toFixed(4), '');
  }
  if (fit.has_enthalpy_rise) {
    push(
      'fit.enthalpyRise',
      fit.enthalpy_rise.toFixed(3),
      t(isSi ? 'unit.kjPerKg' : 'unit.btuPerLb'),
    );
  }
  if (fit.has_slope) {
    push('fit.slope', fit.slope.toFixed(0), t(isSi ? 'unit.kjPerKg' : 'unit.btuPerLb'));
  }
  return rows;
}

/** What the section needs. */
export interface ProcessSectionProps {
  /** The process being edited, or null. */
  process: Process | null;
  /** Its resolved outlet and load. */
  resolved: ResolvedProcess | null;
  /** Every point, for the endpoint selectors. */
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
  /** The label of the point a process would be added from. */
  fromLabel: string | null;
  /** Writes a change back to the store. */
  onChange: (patch: Partial<Process>) => void;
  /** Adds a process of the given kind, from the selected point. */
  onAdd: (kind: ProcessKind) => void;
  /** Joins the selected point to an existing one and identifies the line. */
  onLink: (secondId: string) => void;
  /** Adopts a fit's back-solved parameters as a parametric process. */
  onAdopt: (kind: ProcessKind, fit: ProcessFitOutput) => void;
  /** Selects a point — the outlet badge is a way to get to it. */
  onSelectPoint: (id: string) => void;
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
  fromLabel,
  onChange,
  onAdd,
  onLink,
  onAdopt,
  onSelectPoint,
  onRemove,
}: ProcessSectionProps) {
  const t = useT();
  const labelOf = (id: string | null) =>
    (id ? points.find((p) => p.id === id)?.label : null) ?? null;
  const power = t(isSi ? 'unit.kilowatt' : 'unit.btuPerHour');
  const flowUnit = t(isSi ? 'unit.kgPerSecond' : 'unit.lbPerHour');
  const temp = t(isSi ? 'unit.celsius' : 'unit.fahrenheit');
  const adoptAs = resolved?.fit ? ADOPTABLE[resolved.fit.kind] : undefined;

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
          <option value="">
            {/* Naming the inlet in the button is what stops a process being
                bound to a point the user cannot see, which is what the old
                `selected ?? points[0]` fallback did silently. */}
            {fromLabel ? t('process.addFrom', { label: fromLabel }) : t('process.add')}
          </option>
          {PROCESS_KINDS.map(([kind, key]) => (
            <option key={kind} value={kind}>
              {t(key)}
            </option>
          ))}
        </select>
      </h2>

      {!process ? (
        <>
          <p className="panel__empty">
            {canAdd ? t('process.emptyHint') : t('process.needsPointHint')}
          </p>
          {canAdd && points.length > 1 ? (
            <label className="field">
              <span className="field__label">{t('process.linkTo')}</span>
              <select
                className="field__input"
                value=""
                onChange={(e) => e.target.value && onLink(e.target.value)}
              >
                <option value="">{t('process.choosePoint')}</option>
                {points
                  .filter((p) => p.label !== fromLabel)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </select>
              <span className="field__hint">{t('process.linkToHint')}</span>
            </label>
          ) : null}
        </>
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

            {/* The endpoints, named. A process joins two states, and a panel
                that shows neither of them leaves the user guessing which line
                on the chart they are editing. */}
            <p className="panel__note">
              {t('process.endpoints', {
                from: labelOf(process.fromId) ?? '—',
                to: labelOf(process.toId ?? process.secondId) ?? t('process.noEndpoint'),
              })}
              {process.toId ? (
                <button
                  type="button"
                  className="btn btn--link"
                  onClick={() => onSelectPoint(process.toId!)}
                >
                  {t('process.selectOutlet')}
                </button>
              ) : null}
            </p>

            {needsSecondPoint(process.kind) ? (
              <label className="field">
                <span className="field__label">
                  {t(SECOND_LABEL[process.kind] ?? 'process.targetPoint')}
                </span>
                <select
                  className="field__input"
                  value={process.secondId ?? ''}
                  onChange={(e) => onChange({ secondId: e.target.value || null })}
                >
                  <option value="">{t('process.choosePoint')}</option>
                  {points
                    .filter((p) => p.id !== process.fromId && p.id !== process.toId)
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

          {/* A wet coil is not a warning, it is the result. The old panel showed
              the backend's supersaturation message here and stopped. */}
          {resolved?.dehumidified ? (
            <p className="panel__warning">
              {t('process.wetCoil', {
                condensate: resolved.condensate.toFixed(5),
                unit: flowUnit,
              })}
            </p>
          ) : resolved?.nearSaturation ? (
            <p className="panel__warning">{t('process.nearSaturation')}</p>
          ) : null}

          {resolved?.frostRisk ? (
            <p className="panel__warning">{t('process.frostRisk')}</p>
          ) : null}

          {resolved?.fogged ? (
            <p className="panel__warning">
              {t('process.fogged', {
                condensate: resolved.condensate.toFixed(5),
                unit: flowUnit,
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
                    <td className="readout__unit">{power}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="readout__label">
                    {t('process.moisture')}
                  </th>
                  <td className="readout__value">{resolved.load.moisture.toFixed(6)}</td>
                  <td className="readout__unit">{flowUnit}</td>
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

          {/* The coil, when there is one. All three bypass-factor forms, per
              §4.2, so a result checks against whichever one the reader's
              reference uses. */}
          {resolved?.coil ? (
            <>
              <h2 className="panel__section">{t('process.sectionCoil')}</h2>
              <table className="readout">
                <tbody>
                  <tr>
                    <th scope="row" className="readout__label">
                      {t('design.adp')}
                    </th>
                    <td className="readout__value">{resolved.coil.adp.dbt.toFixed(2)}</td>
                    <td className="readout__unit">{temp}</td>
                  </tr>
                  {[
                    ['design.bfTemperature', resolved.coil.bf_temperature],
                    ['design.bfHumidityRatio', resolved.coil.bf_humidity_ratio],
                    ['design.bfEnthalpy', resolved.coil.bf_enthalpy],
                    ['design.coilShr', resolved.coil.shr],
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
                      {t('design.condensate')}
                    </th>
                    <td className="readout__value">
                      {resolved.coil.condensate.toFixed(5)}
                    </td>
                    <td className="readout__unit">{flowUnit}</td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : null}

          {/* What the engine made of a line between two points, and the offer to
              turn that reading into a process that can be edited. */}
          {resolved?.fit ? (
            <>
              <h2 className="panel__section">{t('process.sectionFit')}</h2>
              <p className="panel__note">{t(FIT_LABEL[resolved.fit.kind])}</p>
              <table className="readout">
                <tbody>
                  {fitRows(resolved.fit, isSi, t).map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className="readout__label">
                        {row.label}
                      </th>
                      <td className="readout__value">{row.value}</td>
                      <td className="readout__unit">{row.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {adoptAs ? (
                <button
                  type="button"
                  className="btn btn--block"
                  onClick={() => onAdopt(adoptAs, resolved.fit!)}
                >
                  {t('process.adopt')}
                </button>
              ) : (
                <p className="panel__note">{t('process.adoptUnavailable')}</p>
              )}
            </>
          ) : null}
        </>
      )}
    </>
  );
}
