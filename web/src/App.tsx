/**
 * Application root.
 *
 * Owns the shell's state for now: the active tool, unit system, elevation, and
 * the single state point the properties panel edits. Phase 6 lifts the unit
 * system and elevation into `useProjectStore` and the point into
 * `usePsychStore`; the shape of what is passed down does not change when it
 * does, which is the point of keeping the shell components presentational.
 */

import { useEffect, useState } from 'react';

import { AppShell } from './shell/AppShell';
import { PropertiesPanel } from './shell/PropertiesPanel';
import { Toolbox, type ToolId, type ViewActionId } from './shell/Toolbox';
import { TopNav } from './shell/TopNav';
import { Viewport } from './shell/Viewport';
import { useTheme } from './shell/useTheme';
import { useT } from './i18n/useT';
import {
  calculate_state,
  engine_version,
  initEngine,
  InputState,
  StatePointInput,
  type StatePointOutput,
} from './psychro';

export function App() {
  const t = useT();
  const { theme, toggleTheme } = useTheme();

  const [engineReady, setEngineReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tool, setTool] = useState<ToolId>('select');
  const [isSi, setIsSi] = useState(true);
  const [altitude, setAltitude] = useState('0');

  const [dryBulb, setDryBulb] = useState('24');
  const [mode, setMode] = useState<InputState>(InputState.DbtRh);
  const [secondValue, setSecondValue] = useState('50');
  const [realGas, setRealGas] = useState(true);

  useEffect(() => {
    initEngine().then(
      () => setEngineReady(true),
      (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  let result: StatePointOutput | null = null;
  let error: string | null = null;
  if (engineReady) {
    try {
      result = calculate_state(
        new StatePointInput(
          Number(dryBulb),
          Number(secondValue),
          mode,
          Number(altitude),
          isSi,
          realGas,
        ),
      );
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="panel__error">
        {t('engine.loadFailed', { message: loadError })}
      </p>
    );
  }

  return (
    <AppShell
      nav={
        <TopNav
          projectName={t('app.untitledProject')}
          isSi={isSi}
          onUnitChange={setIsSi}
          altitude={altitude}
          onAltitudeChange={setAltitude}
          theme={theme}
          onThemeToggle={toggleTheme}
          engineVersion={engineReady ? engine_version() : null}
        />
      }
      toolbox={
        <Toolbox
          activeTool={tool}
          onToolChange={setTool}
          onViewAction={(action: ViewActionId) => void action}
        />
      }
      viewport={<Viewport />}
      panel={
        <PropertiesPanel
          dryBulb={dryBulb}
          onDryBulbChange={setDryBulb}
          mode={mode}
          onModeChange={setMode}
          secondValue={secondValue}
          onSecondValueChange={setSecondValue}
          isSi={isSi}
          realGas={realGas}
          onRealGasChange={setRealGas}
          result={result}
          error={error}
        />
      }
    />
  );
}
