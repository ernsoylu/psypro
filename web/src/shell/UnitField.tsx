/**
 * A labelled number with its own unit dropdown.
 *
 * The unit beside an input used to be a caption: it told you which unit the
 * document was in and left you to convert. Here it is a control, because the
 * figure a user has in front of them is in whatever unit its source used — a
 * fan curve in m³/h, a schedule in kW, an outdoor design condition in °F — and
 * a tool that makes them convert first is a tool that gets converted-wrong
 * numbers typed into it.
 *
 * The document is unchanged by any of this. The value is converted on the way
 * in and stored in the document's own units, so switching the unit dropdown
 * moves no point on the chart: the same state is being written a different way.
 * Derived readings answer to the top-nav switch alone, which is the one place
 * a document-wide unit belongs.
 *
 * Volumetric flow only appears when the air state is in hand, since `V̇ / v_da`
 * needs the stream's specific volume. Without it the field offers the mass
 * units and says nothing it cannot back up.
 */

import { useId, useMemo, useState } from 'react';

import { NumberField } from './NumberField';
import { useT } from '../i18n/useT';
import { DIMENSIONS, convert, documentUnit, unitById } from '../units';
import type { DimensionId, UnitContext } from '../units';

/** What a unit-bearing field needs. */
export interface UnitFieldProps {
  /** The field's name, already translated. */
  label: string;
  /** What kind of quantity this is. */
  dimension: DimensionId;
  /** Whether the document is in SI — this sets the default unit. */
  isSi: boolean;
  /** The stored value, in the document's units. */
  value: number;
  /** Writes a new value back, in the document's units. */
  onCommit: (value: number) => void;
  /** Dry-air specific volume in m³/kg, where a volumetric entry is meaningful. */
  vDaSi?: number | null;
  /** Whether the field refuses edits. */
  disabled?: boolean;
}

export function UnitField({
  label,
  dimension,
  isSi,
  value,
  onCommit,
  vDaSi = null,
  disabled,
}: UnitFieldProps) {
  const t = useT();
  const id = useId();
  // `null` means "follow the document". An explicit choice outlives a unit
  // switch, because a user typing in cfm is still typing in cfm afterwards.
  const [chosen, setChosen] = useState<string | null>(null);

  const ctx: UnitContext = { vDaSi };
  const options = useMemo(
    () => DIMENSIONS[dimension].units.filter((u) => !u.needsState || vDaSi !== null),
    [dimension, vDaSi],
  );

  const stored = documentUnit(dimension, isSi);
  const picked = chosen === null ? stored : unitById(dimension, chosen);
  // A volumetric unit chosen while a state was in hand, and the state has since
  // gone: fall back rather than show a number derived from nothing.
  const unit = options.includes(picked) ? picked : stored;

  return (
    <div className="field">
      <span className="field__label">
        <label htmlFor={id}>{label}</label>
        {options.length > 1 ? (
          <select
            className="field__unit field__unit--select"
            value={unit.id}
            aria-label={t('unit.selectFor', { field: label })}
            disabled={disabled}
            onChange={(e) => setChosen(e.target.value)}
          >
            {options.map((u) => (
              <option key={u.id} value={u.id}>
                {t(u.key)}
              </option>
            ))}
          </select>
        ) : unit.key === 'unit.none' ? null : (
          <span className="field__unit">{t(unit.key)}</span>
        )}
      </span>
      <NumberField
        id={id}
        className="field__input"
        disabled={disabled ?? false}
        value={convert(value, stored, unit, ctx)}
        format={(v) => v.toFixed(unit.decimals)}
        onCommit={(entered) => onCommit(convert(entered, unit, stored, ctx))}
      />
    </div>
  );
}
