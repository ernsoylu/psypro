/**
 * Top navigation — project actions on the left, global state on the right.
 *
 * "Global state" is the load-bearing half. Unit system and site elevation
 * invalidate every derived value in the document, which is why they live up
 * here next to the project name rather than inside a settings dialog: a reading
 * that changes when you change them should be one glance away from the control
 * that changed it.
 */

import { useState } from 'react';

import { Icon, type IconName } from './Icon';
import { NumberField } from './NumberField';
import { useT } from '../i18n/useT';
import { DIMENSIONS, convert, documentUnit, unitById } from '../units';
import { ChartLayout } from '../psychro';
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
  /** Which chart construction is drawn. */
  layout: ChartLayout;
  /** Switches the chart construction. */
  onLayoutChange: (layout: ChartLayout) => void;
  /** Engine version, or null while the module is still loading. */
  engineVersion: string | null;
  /** Runs a file action. */
  onFileAction: (action: FileActionId) => void;
  /** Which export formats are on offer. */
  exportFormats: { id: string; label: string }[];
  /** Runs an export. */
  onExport: (format: string) => void;
}

/** What a file action does, keyed so the handler can switch on it. */
export type FileActionId = 'save' | 'open' | 'export';

/** Elevation converts without an air state — it is a length. */
const NO_STATE = { vDaSi: null };

const FILE_ACTIONS: { id: FileActionId; key: TranslationKey; icon: IconName }[] = [
  { id: 'save', key: 'nav.save', icon: 'save' },
  { id: 'open', key: 'nav.open', icon: 'open' },
  { id: 'export', key: 'nav.export', icon: 'export' },
];

export function TopNav({
  projectName,
  isSi,
  onUnitChange,
  altitude,
  onAltitudeChange,
  theme,
  onThemeToggle,
  layout,
  onLayoutChange,
  engineVersion,
  onFileAction,
  exportFormats,
  onExport,
}: TopNavProps) {
  const t = useT();
  const [chosenElevation, setElevationUnit] = useState<string | null>(null);
  const documentElevation = documentUnit('length', isSi);
  const elevationUnit =
    chosenElevation === null ? documentElevation : unitById('length', chosenElevation);

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
        {FILE_ACTIONS.filter((a) => a.id !== 'export').map(({ id, key, icon }) => (
          <button
            key={key}
            type="button"
            className="btn"
            onClick={() => onFileAction(id)}
          >
            <Icon name={icon} />
            {t(key)}
          </button>
        ))}
        <span className="btn btn--select">
          <Icon name="export" />
          <select
            className="btn__select"
            value=""
            aria-label={t('nav.export')}
            onChange={(e) => e.target.value && onExport(e.target.value)}
          >
            <option value="">{t('nav.export')}</option>
            {exportFormats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </span>
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

        <select
          className="select"
          value={layout}
          aria-label={t('layout.label')}
          onChange={(e) => onLayoutChange(Number(e.target.value) as ChartLayout)}
        >
          <option value={ChartLayout.Ashrae}>{t('layout.ashrae')}</option>
          <option value={ChartLayout.MollierIx}>{t('layout.mollier')}</option>
        </select>

        <span className="field-inline">
          <Icon name="elevation" size={14} />
          <span className="field-inline__label">{t('nav.elevation')}</span>
          {/* Typed in whichever unit is chosen and stored in the document's:
              a site is 1609 m or 5280 ft and both are the same site. Through
              NumberField, so a keystroke is not converted and re-rounded back
              into the box before the next one arrives. */}
          <NumberField
            className="field-inline__input"
            aria-label={t('nav.elevationLabel')}
            value={convert(
              Number(altitude) || 0,
              documentElevation,
              elevationUnit,
              NO_STATE,
            )}
            format={(v) => String(Math.round(v))}
            onCommit={(entered) =>
              // Stored at full precision even though it is shown to the metre:
              // 5280 ft is 1609.344 m, and rounding that on the way in comes
              // back as 5279 ft the moment the reader looks again.
              onAltitudeChange(
                String(
                  Number(
                    convert(entered, elevationUnit, documentElevation, NO_STATE).toFixed(
                      4,
                    ),
                  ),
                ),
              )
            }
          />
          <select
            className="field-inline__unit field-inline__unit--select"
            value={elevationUnit.id}
            aria-label={t('unit.selectFor', { field: t('nav.elevationLabel') })}
            onChange={(e) => setElevationUnit(e.target.value)}
          >
            {DIMENSIONS.length.units.map((u) => (
              <option key={u.id} value={u.id}>
                {t(u.key)}
              </option>
            ))}
          </select>
        </span>

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
