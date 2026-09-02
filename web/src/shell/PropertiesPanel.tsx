/**
 * Right-hand properties panel — known inputs above, derived properties below.
 *
 * This panel is where §3.2's three distinctions either survive or get lost, so
 * they are structural rather than editorial:
 *
 * * **Relative humidity and degree of saturation are separate rows**, each with
 *   its defining ratio beside the name. They agree only at 0% and 100%, and a
 *   panel that shows one of them labelled "humidity" teaches the conflation.
 * * **Wet-bulb is labelled thermodynamic**, because a psychrometer reads
 *   something else and the difference is not a rounding error.
 * * **Specific volume says "dry-air basis"** and density says "reference only",
 *   because a mass balance run on moist-air density is wrong by about 1% and
 *   nothing in the number itself says so.
 *
 * Phase 6 replaces the local input state with `usePsychStore` and adds
 * click-to-place. The presentation is already the shape that will need.
 */

import { Icon } from './Icon';
import { useT, type Translator } from '../i18n/useT';
import { InputState, type StatePointOutput } from '../psychro';
import type { TranslationKey } from '../i18n';

/** The second known property, paired with the unit label for each system. */
export const INPUT_MODES = [
  {
    state: InputState.DbtRh,
    key: 'prop.relativeHumidity',
    si: 'unit.percent',
    ip: 'unit.percent',
  },
  {
    state: InputState.DbtWbt,
    key: 'prop.wetBulb',
    si: 'unit.celsius',
    ip: 'unit.fahrenheit',
  },
  {
    state: InputState.DbtDewPoint,
    key: 'prop.dewPoint',
    si: 'unit.celsius',
    ip: 'unit.fahrenheit',
  },
  {
    state: InputState.DbtHumidityRatio,
    key: 'prop.humidityRatio',
    si: 'unit.kgPerKg',
    ip: 'unit.lbPerLb',
  },
  {
    state: InputState.DbtEnthalpy,
    key: 'prop.enthalpy',
    si: 'unit.kjPerKg',
    ip: 'unit.btuPerLb',
  },
] as const satisfies readonly {
  state: InputState;
  key: TranslationKey;
  si: TranslationKey;
  ip: TranslationKey;
}[];

/** One derived row: label, formatted value, unit. */
interface DerivedRow {
  label: string;
  detail?: string;
  value: string;
  unit: string;
}

/** Builds the derived rows in the order an engineer reads them. */
function derivedRows(o: StatePointOutput, si: boolean, t: Translator): DerivedRow[] {
  const temp = t(si ? 'unit.celsius' : 'unit.fahrenheit');
  return [
    { label: t('prop.dryBulb'), value: o.dbt.toFixed(2), unit: temp },
    { label: t('prop.wetBulb'), value: o.wbt.toFixed(2), unit: temp },
    {
      label: t(o.dew_point < 0 ? 'prop.frostPoint' : 'prop.dewPoint'),
      value: o.dew_point.toFixed(2),
      unit: temp,
    },
    {
      label: t('prop.humidityRatio'),
      value: o.humidity_ratio.toFixed(6),
      unit: t(si ? 'unit.kgPerKg' : 'unit.lbPerLb'),
    },
    {
      label: t('prop.humidityRatio'),
      value: o.humidity_ratio_grains.toFixed(1),
      unit: t('unit.grainsPerLb'),
    },
    {
      label: t('prop.relativeHumidity'),
      detail: t('prop.relativeHumidityFormula'),
      value: o.rh.toFixed(2),
      unit: t('unit.percent'),
    },
    {
      label: t('prop.degreeOfSaturation'),
      detail: t('prop.degreeOfSaturationFormula'),
      value: o.degree_of_saturation.toFixed(2),
      unit: t('unit.percent'),
    },
    {
      label: t('prop.enthalpy'),
      value: o.enthalpy.toFixed(3),
      unit: t(si ? 'unit.kjPerKg' : 'unit.btuPerLb'),
    },
    {
      label: t('prop.specificVolume'),
      value: o.specific_volume.toFixed(5),
      unit: t(si ? 'unit.m3PerKg' : 'unit.ft3PerLb'),
    },
    {
      label: t('prop.density'),
      value: o.density.toFixed(5),
      unit: t(si ? 'unit.kgPerM3' : 'unit.lbPerFt3'),
    },
    {
      label: t('prop.vapourPressure'),
      value: o.vapor_pressure.toFixed(4),
      unit: t(si ? 'unit.kilopascal' : 'unit.psi'),
    },
    {
      label: t('prop.barometricPressure'),
      value: o.barometric_pressure.toFixed(4),
      unit: t(si ? 'unit.kilopascal' : 'unit.psi'),
    },
  ];
}

/** What the panel needs from the application above it. */
export interface PropertiesPanelProps {
  /** Dry-bulb temperature, as typed. */
  dryBulb: string;
  /** Accepts a new dry-bulb entry. */
  onDryBulbChange: (value: string) => void;
  /** Which second property is being supplied. */
  mode: InputState;
  /** Selects the second property. */
  onModeChange: (mode: InputState) => void;
  /** The second property's value, as typed. */
  secondValue: string;
  /** Accepts a new second-property entry. */
  onSecondValueChange: (value: string) => void;
  /** Whether the document is in SI. */
  isSi: boolean;
  /** Whether the real-gas enhancement factor is applied. */
  realGas: boolean;
  /** Toggles the enhancement factor, which is the teaching-mode switch. */
  onRealGasChange: (realGas: boolean) => void;
  /** The resolved state, or null while loading or on error. */
  result: StatePointOutput | null;
  /** Why the state could not be resolved, if it could not. */
  error: string | null;
}

export function PropertiesPanel({
  dryBulb,
  onDryBulbChange,
  mode,
  onModeChange,
  secondValue,
  onSecondValueChange,
  isSi,
  realGas,
  onRealGasChange,
  result,
  error,
}: PropertiesPanelProps) {
  const t = useT();
  const active = INPUT_MODES.find((m) => m.state === mode) ?? INPUT_MODES[0];

  return (
    <aside className="panel" aria-label={t('panel.label')}>
      <div className="panel__header">
        <span className="panel__title">
          <span className="panel__swatch" />
          {t('panel.title')}
        </span>
        <button type="button" className="btn btn--icon" aria-label={t('panel.menu')}>
          <Icon name="menu" />
        </button>
      </div>

      <h2 className="panel__section">{t('panel.sectionInputs')}</h2>

      <div className="panel__fields">
        <label className="field">
          <span className="field__label">
            {t('input.dryBulb')}
            <span className="field__unit">
              {t(isSi ? 'unit.celsius' : 'unit.fahrenheit')}
            </span>
          </span>
          <input
            className="field__input"
            value={dryBulb}
            inputMode="decimal"
            onChange={(e) => onDryBulbChange(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">{t('input.secondProperty')}</span>
          <select
            className="field__input"
            value={mode}
            onChange={(e) => onModeChange(Number(e.target.value) as InputState)}
          >
            {INPUT_MODES.map((m) => (
              <option key={m.key} value={m.state}>
                {t(m.key)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">
            {t(active.key)}
            <span className="field__unit">{t(isSi ? active.si : active.ip)}</span>
          </span>
          <input
            className="field__input"
            value={secondValue}
            inputMode="decimal"
            onChange={(e) => onSecondValueChange(e.target.value)}
          />
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={realGas}
            onChange={(e) => onRealGasChange(e.target.checked)}
          />
          <span>
            {t('input.realGas')}
            <span className="checkbox__hint">{t('input.realGasHint')}</span>
          </span>
        </label>
      </div>

      {error ? (
        <p className="panel__error" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <>
          <h2 className="panel__section">{t('panel.sectionDerived')}</h2>
          <table className="readout">
            <tbody>
              {derivedRows(result, isSi, t).map((row) => (
                <tr key={`${row.label}-${row.unit}`}>
                  <th scope="row" className="readout__label">
                    {row.label}
                    {row.detail ? (
                      <span className="readout__detail">{row.detail}</span>
                    ) : null}
                  </th>
                  <td className="readout__value">{row.value}</td>
                  <td className="readout__unit">{row.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </aside>
  );
}
