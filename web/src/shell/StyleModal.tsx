/**
 * The line-styling matrix — REQUIREMENTS.md §8.
 *
 * One row per curve family: colour, line style, and width. The defaults are the
 * chart's historical drawing, so the modal opens describing what the reader is
 * already looking at, and every control is a deviation from that.
 *
 * Colour swatches show the *effective* colour — the override when there is one,
 * otherwise the theme's colour for the family — so a reader recolouring one
 * family sees it next to the palette it sits in. Swatches are disabled when the
 * theme has not resolved (the test environment), because an input with no
 * palette behind it would edit nothing.
 *
 * Two boundary rules the modal states rather than hides: the saturation curve
 * follows the relative-humidity colour but keeps its own solid line and weight,
 * and styles are session state — they reach the chart and its exports, but not
 * the `.psy` file.
 */

import { useEffect } from 'react';

import { useChartTokens } from '../chart/useChartTokens';
import { useT } from '../i18n/useT';
import {
  FAMILY_LABELS,
  MAX_STYLE_WIDTH,
  MIN_STYLE_WIDTH,
  type FamilyStyle,
  type LineStyle,
} from '../store/useStyleStore';
import type { TranslationKey } from '../i18n';
import type { CurveFamilyId } from '../psychro';

/** What the modal needs. */
export interface StyleModalProps {
  /** The styling matrix as it stands. */
  styles: Record<CurveFamilyId, FamilyStyle>;
  /** Patches one family's style. */
  onSetStyle: (family: CurveFamilyId, patch: Partial<FamilyStyle>) => void;
  /** Restores one family to the defaults. */
  onResetFamily: (family: CurveFamilyId) => void;
  /** Restores every family to the defaults. */
  onResetAll: () => void;
  /** Closes the modal. */
  onClose: () => void;
}

/** The line styles offered, in the order they appear, and their labels. */
const LINE_STYLES: readonly LineStyle[] = ['solid', 'dotted', 'dashed'];
const LINE_STYLE_LABELS = {
  solid: 'styleModal.solid',
  dotted: 'styleModal.dotted',
  dashed: 'styleModal.dashed',
} as const satisfies Record<LineStyle, TranslationKey>;

/** A colour input takes a seven-character hex value, and only that. */
function asHex(candidate: string): string | '' {
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : '';
}

export function StyleModal({
  styles,
  onSetStyle,
  onResetFamily,
  onResetAll,
  onClose,
}: StyleModalProps) {
  const t = useT();
  const tokens = useChartTokens();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay">
      {/* The backdrop is a real button so dismissing it by click has a matching
          keyboard gesture — a div with only an onClick is invisible to one. */}
      <button
        type="button"
        className="modal-overlay__backdrop"
        aria-label={t('styleModal.closeBackdrop')}
        onClick={onClose}
      />
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('styleModal.title')}
      >
        <div className="panel__header">
          <span className="panel__title">{t('styleModal.title')}</span>
        </div>

        <table className="style-matrix">
          <thead>
            <tr>
              <th scope="col">{t('styleModal.family')}</th>
              <th scope="col">{t('styleModal.color')}</th>
              <th scope="col">{t('styleModal.lineStyle')}</th>
              <th scope="col">{t('styleModal.width')}</th>
              <th scope="col">{t('styleModal.reset')}</th>
            </tr>
          </thead>
          <tbody>
            {FAMILY_LABELS.map(([family, key]) => {
              const style = styles[family];
              const effective = style.color ?? tokens?.family[family] ?? '';
              const swatch = asHex(effective);
              return (
                <tr key={family}>
                  <th scope="row">{t(key)}</th>
                  <td>
                    <input
                      type="color"
                      className="style-matrix__color"
                      value={swatch}
                      disabled={!tokens || swatch === ''}
                      onChange={(event) =>
                        onSetStyle(family, { color: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="select"
                      value={style.lineStyle}
                      onChange={(event) =>
                        onSetStyle(family, { lineStyle: event.target.value as LineStyle })
                      }
                    >
                      {LINE_STYLES.map((lineStyle) => (
                        <option key={lineStyle} value={lineStyle}>
                          {t(LINE_STYLE_LABELS[lineStyle])}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      className="field__input style-matrix__width"
                      min={MIN_STYLE_WIDTH}
                      max={MAX_STYLE_WIDTH}
                      step={0.25}
                      value={style.width}
                      onChange={(event) => {
                        const width = Number(event.target.value);
                        if (Number.isFinite(width)) onSetStyle(family, { width });
                      }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      aria-label={t('styleModal.resetFamily')}
                      onClick={() => onResetFamily(family)}
                    >
                      {t('styleModal.reset')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="modal__footer">
          <p className="modal__note">{t('styleModal.saturationNote')}</p>
          <p className="modal__note">{t('styleModal.sessionNote')}</p>
          <div className="modal__actions">
            <button type="button" className="btn" onClick={onResetAll}>
              {t('styleModal.resetAll')}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              {t('styleModal.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
