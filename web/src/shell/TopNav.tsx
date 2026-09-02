/**
 * Top navigation — project actions on the left, global state on the right.
 *
 * "Global state" is the load-bearing half. Unit system and site elevation
 * invalidate every derived value in the document, which is why they live up
 * here next to the project name rather than inside a settings dialog: a reading
 * that changes when you change them should be one glance away from the control
 * that changed it.
 */

import { Icon, type IconName } from './Icon';
import { useT } from '../i18n/useT';
import type { TranslationKey } from '../i18n';
import type { Theme } from './useTheme';

/** What the nav needs from the application above it. */
export interface TopNavProps {
  /** Project name shown beside the brand. */
  projectName: string;
  /** Whether the document is in SI. */
  isSi: boolean;
  /** Switches the unit system. */
  onUnitChange: (isSi: boolean) => void;
  /** Site elevation, in the active unit system. */
  altitude: string;
  /** Accepts a new elevation. */
  onAltitudeChange: (value: string) => void;
  /** The active theme. */
  theme: Theme;
  /** Flips the theme. */
  onThemeToggle: () => void;
  /** Engine version, or null while the module is still loading. */
  engineVersion: string | null;
}

const FILE_ACTIONS: { key: TranslationKey; icon: IconName }[] = [
  { key: 'nav.save', icon: 'save' },
  { key: 'nav.open', icon: 'open' },
  { key: 'nav.export', icon: 'export' },
];

export function TopNav({
  projectName,
  isSi,
  onUnitChange,
  altitude,
  onAltitudeChange,
  theme,
  onThemeToggle,
  engineVersion,
}: TopNavProps) {
  const t = useT();

  return (
    <header className="topnav">
      <div className="topnav__group">
        <span className="brand">
          <Icon name="mark" size={18} />
          <span className="brand__name">{t('app.name')}</span>
        </span>
        <span className="rule" />
        <span className="topnav__project">{projectName}</span>
        <span className="topnav__engine">
          {engineVersion === null
            ? t('engine.loading')
            : t('engine.version', { version: engineVersion })}
        </span>
      </div>

      <div className="topnav__group">
        {FILE_ACTIONS.map(({ key, icon }) => (
          <button key={key} type="button" className="btn">
            <Icon name={icon} />
            {t(key)}
          </button>
        ))}
      </div>

      <div className="topnav__group">
        <div className="segmented" role="group" aria-label={t('nav.unitSystem')}>
          <button
            type="button"
            className="segmented__option"
            aria-pressed={!isSi}
            onClick={() => onUnitChange(false)}
          >
            {t('nav.unitIp')}
          </button>
          <button
            type="button"
            className="segmented__option"
            aria-pressed={isSi}
            onClick={() => onUnitChange(true)}
          >
            {t('nav.unitSi')}
          </button>
        </div>

        <label className="field-inline">
          <Icon name="elevation" size={14} />
          <span className="field-inline__label">{t('nav.elevation')}</span>
          <input
            className="field-inline__input"
            value={altitude}
            inputMode="decimal"
            aria-label={t('nav.elevationLabel')}
            onChange={(e) => onAltitudeChange(e.target.value)}
          />
          <span className="field-inline__unit">{t(isSi ? 'unit.metre' : 'unit.foot')}</span>
        </label>

        <button
          type="button"
          className="btn btn--icon"
          aria-label={t(theme === 'dark' ? 'nav.themeToLight' : 'nav.themeToDark')}
          onClick={onThemeToggle}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>
    </header>
  );
}
