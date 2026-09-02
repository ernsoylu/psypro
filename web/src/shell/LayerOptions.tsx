/**
 * The layers panel: which curve families and which envelopes are drawn.
 *
 * Every entry carries *why* it is there rather than only what it is called.
 * §10.3 asks for that explicitly for the data-centre envelopes — a dew-point
 * ceiling that exists to stop conductive anodic filament growth is a different
 * constraint from one that exists for comfort, and a reader who knows which is
 * which can make a judgement about exceeding it. A tool that shows only the
 * number teaches the number.
 */

import { useT } from '../i18n/useT';
import { ENVELOPES, PROFILES } from '../data';
import { FAMILY_LABELS } from '../store/useStyleStore';
import type { CurveFamilyId } from '../psychro';

/** What the panel needs. */
export interface LayerOptionsProps {
  visible: Record<CurveFamilyId, boolean>;
  onToggleFamily: (family: CurveFamilyId) => void;
  /** Opens the line-styling matrix for the grid families. */
  onOpenStyles: () => void;
  showLabels: boolean;
  onShowLabels: (show: boolean) => void;
  profileId: string;
  onProfileChange: (id: string) => void;
  visibleEnvelopes: string[];
  onToggleEnvelope: (id: string) => void;
}

export function LayerOptions({
  visible,
  onToggleFamily,
  onOpenStyles,
  showLabels,
  onShowLabels,
  profileId,
  onProfileChange,
  visibleEnvelopes,
  onToggleEnvelope,
}: LayerOptionsProps) {
  const t = useT();
  const profile = PROFILES.find((p) => p.id === profileId);

  return (
    <aside className="panel" aria-label={t('layers.label')}>
      <div className="panel__header">
        <span className="panel__title">{t('layers.label')}</span>
      </div>

      <h2 className="panel__section">{t('layers.profile')}</h2>
      <div className="panel__fields">
        <label className="field">
          <span className="field__label">{t('layers.profileLabel')}</span>
          <select
            className="field__input"
            value={profileId}
            onChange={(e) => onProfileChange(e.target.value)}
          >
            {PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {profile ? <p className="panel__note">{profile.note}</p> : null}
        {profile ? (
          <p className="panel__note">
            {t('layers.shrRange', {
              min: profile.shrRange[0].toFixed(2),
              max: profile.shrRange[1].toFixed(2),
            })}
          </p>
        ) : null}
      </div>

      <h2 className="panel__section">{t('layers.envelopes')}</h2>
      <div className="panel__fields">
        {ENVELOPES.map((envelope) => (
          <div className="envelope" key={envelope.id}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={visibleEnvelopes.includes(envelope.id)}
                onChange={() => onToggleEnvelope(envelope.id)}
              />
              <span>
                {envelope.name}
                <span className="checkbox__hint">{envelope.source}</span>
              </span>
            </label>
            <p className="envelope__why">{envelope.rationale}</p>
          </div>
        ))}
      </div>

      <h2 className="panel__section">{t('layers.grid')}</h2>
      <div className="panel__fields">
        {FAMILY_LABELS.map(([family, key]) => (
          <label className="checkbox" key={family}>
            <input
              type="checkbox"
              checked={visible[family] ?? true}
              onChange={() => onToggleFamily(family)}
            />
            <span>{t(key)}</span>
          </label>
        ))}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => onShowLabels(e.target.checked)}
          />
          <span>{t('layers.showLabels')}</span>
        </label>
        <button type="button" className="btn btn--block" onClick={onOpenStyles}>
          {t('layers.openStyles')}
        </button>
        <p className="panel__note">{t('layers.saturationNote')}</p>
      </div>
    </aside>
  );
}
