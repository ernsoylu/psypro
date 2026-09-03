/**
 * Right-hand properties panel — known inputs above, derived properties below.
 *
 * Two-way, and the same both ways: typing a number and dragging the marker write
 * the *same two fields* on the *same stored point*. There is no "chart point"
 * and "typed point" to reconcile, which is the bug that shape of design
 * produces on about the third interaction.
 *
 * This panel is also where §3.2's three distinctions either survive or get lost,
 * so they are structural rather than editorial:
 *
 * * **Relative humidity and degree of saturation are separate rows**, each with
 *   its defining ratio beside the name. They agree only at 0% and 100%, and a
 *   panel showing one of them labelled "humidity" teaches the conflation.
 * * **Wet-bulb is labelled thermodynamic**, because a psychrometer reads
 *   something else and the difference is not a rounding error.
 * * **Specific volume says "dry-air basis"** and density says "reference only",
 *   because a mass balance run on moist-air density is wrong by about 1% and
 *   nothing in the number itself says so.
 *
 * A point placed by a process is shown differently, because it *is* different:
 * its inputs live on the process, so the fields that would edit them are
 * replaced by the process that owns it and a way to break that link. Showing
 * editable fields that silently do nothing would be the worse lie.
 */

import type { ReactNode } from 'react';

import { formatProperties } from '../chart/format';
import { Icon } from './Icon';
import { UnitField } from './UnitField';
import { useT } from '../i18n/useT';
import { InputState } from '../psychro';
import type { TranslationKey } from '../i18n';
import { SECOND_PROPERTY_DIMENSION } from '../store/usePsychStore';
import type { NewStatePoint, StatePoint } from '../store/usePsychStore';
import type { ResolvedPoint } from '../store/useResolvedPoints';

/**
 * The second known property, paired with the *kind* of quantity it is.
 *
 * The dimension, not a unit: which unit it is typed in is the field's business
 * and the reader's choice, and the decimals a drag leaves behind come from that
 * unit rather than from a table here.
 */
export const INPUT_MODES = [
  { state: InputState.DbtRh, key: 'prop.relativeHumidity' },
  { state: InputState.DbtWbt, key: 'prop.wetBulb' },
  { state: InputState.DbtDewPoint, key: 'prop.dewPoint' },
  { state: InputState.DbtHumidityRatio, key: 'prop.humidityRatio' },
  { state: InputState.DbtEnthalpy, key: 'prop.enthalpy' },
] as const satisfies readonly { state: InputState; key: TranslationKey }[];

/** What the panel needs from the application above it. */
export interface PropertiesPanelProps {
  /** The point being edited, or null when nothing is selected. */
  point: StatePoint | null;
  /** That point's resolved properties. */
  resolved: ResolvedPoint | null;
  /** Whether the document is in SI. */
  isSi: boolean;
  /** Whether the real-gas enhancement factor is applied. */
  realGas: boolean;
  /** Toggles the enhancement factor, which is the teaching-mode switch. */
  onRealGasChange: (realGas: boolean) => void;
  /** Writes a change back to the store. */
  onChange: (patch: Partial<NewStatePoint>) => void;
  /** Adds a point at a sensible default state. */
  onAdd: () => void;
  /** Deletes the selected point. */
  onRemove: () => void;
  /**
   * The document outline, rendered above everything else.
   *
   * First because it is the table of contents: what is in the document, and
   * what joins what. The inspector below it is a view of *one* row.
   */
  outline?: ReactNode;
  /** The process editor, rendered below the derived properties. */
  processSection?: ReactNode;
  /**
   * The process that places this point, when one does.
   *
   * Present means the point is derived: its stored numbers are dormant and the
   * inputs section says so rather than offering fields that do nothing.
   */
  producedBy?: { id: string; label: string } | null;
  /** Whether dragging this point can move its process's parameter. */
  dragInvertible?: boolean;
  /** Breaks the link, keeping the point where it is. */
  onDetach?: () => void;
  /** Selects the process that places this point. */
  onSelectProducer?: (id: string) => void;
}

export function PropertiesPanel({
  point,
  resolved,
  isSi,
  realGas,
  onRealGasChange,
  onChange,
  onAdd,
  onRemove,
  outline,
  processSection,
  producedBy = null,
  dragInvertible = false,
  onDetach,
  onSelectProducer,
}: PropertiesPanelProps) {
  const t = useT();

  if (!point) {
    return (
      <aside className="panel" aria-label={t('panel.label')}>
        <div className="panel__header">
          <span className="panel__title">{t('panel.noSelection')}</span>
        </div>
        <p className="panel__empty">{t('panel.emptyHint')}</p>
        <div className="panel__fields">
          <button type="button" className="btn btn--block" onClick={onAdd}>
            {t('panel.addPoint')}
          </button>
        </div>
        {outline}
        {processSection}
      </aside>
    );
  }

  const active = INPUT_MODES.find((m) => m.state === point.mode) ?? INPUT_MODES[0];

  return (
    <aside className="panel" aria-label={t('panel.label')}>
      <div className="panel__header">
        <span className="panel__title">
          <span className="panel__swatch" />
          <input
            className="panel__name"
            value={point.label}
            aria-label={t('panel.pointLabel')}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </span>
        <button
          type="button"
          className="btn btn--icon"
          aria-label={t('panel.removePoint')}
          onClick={onRemove}
        >
          <Icon name="trash" />
        </button>
      </div>

      {outline}

      <h2 className="panel__section">{t('panel.sectionInputs')}</h2>

      {producedBy ? (
        <div className="panel__fields">
          <p className="panel__note">
            {t('point.derived', { process: producedBy.label })}
            {onSelectProducer ? (
              <button
                type="button"
                className="btn btn--link"
                onClick={() => onSelectProducer(producedBy.id)}
              >
                {t('process.selectOutlet')}
              </button>
            ) : null}
          </p>
          <p className="panel__note">
            {dragInvertible ? t('point.derivedHint') : t('point.dragLocked')}
          </p>
          {onDetach ? (
            <button type="button" className="btn btn--block" onClick={onDetach}>
              {t('point.detach')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="panel__fields">
          <UnitField
            label={t('input.dryBulb')}
            dimension="temperature"
            isSi={isSi}
            value={point.dryBulb}
            onCommit={(dryBulb) => onChange({ dryBulb })}
          />

          <label className="field">
            <span className="field__label">{t('input.secondProperty')}</span>
            <select
              className="field__input"
              value={point.mode}
              onChange={(e) => onChange({ mode: Number(e.target.value) as InputState })}
            >
              {INPUT_MODES.map((m) => (
                <option key={m.key} value={m.state}>
                  {t(m.key)}
                </option>
              ))}
            </select>
          </label>

          <UnitField
            label={t(active.key)}
            dimension={SECOND_PROPERTY_DIMENSION[point.mode]}
            isSi={isSi}
            value={point.secondValue}
            onCommit={(secondValue) => onChange({ secondValue })}
          />

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
      )}

      {resolved?.error ? (
        <p className="panel__error" role="alert">
          {resolved.error}
        </p>
      ) : null}

      {resolved?.state ? (
        <>
          <h2 className="panel__section">{t('panel.sectionDerived')}</h2>
          <table className="readout">
            <tbody>
              {formatProperties(resolved.state, isSi, t).map((row) => (
                <tr key={row.key}>
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

      {processSection}
    </aside>
  );
}
