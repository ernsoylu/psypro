/**
 * Application root.
 *
 * Holds no document state of its own: units, elevation and layout live in
 * `useProjectStore`, the points in `usePsychStore`, layer visibility in
 * `useStyleStore`. What is left here is the wiring — reading from the stores,
 * deriving the resolved points, and handing both to presentational components.
 *
 * The stores are plain Zustand and are unit-tested without React, which is the
 * whole reason they are not `useState` calls in this file.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ChartCanvas } from './chart/ChartCanvas';
import { DEFAULT_DOMAIN } from './chart/useBaseGrid';
import type { ChartTransform } from './chart/useChartTransform';
import { AppShell } from './shell/AppShell';
import { PropertiesPanel } from './shell/PropertiesPanel';
import { Toolbox, type ToolId, type ViewActionId } from './shell/Toolbox';
import { TopNav } from './shell/TopNav';
import { Viewport } from './shell/Viewport';
import { useTheme } from './shell/useTheme';
import { useT } from './i18n/useT';
import { altitudeInMetres, useProjectStore } from './store/useProjectStore';
import { nextLabel, selectedPoint, usePsychStore } from './store/usePsychStore';
import { useResolvedPoints } from './store/useResolvedPoints';
import { useStyleStore } from './store/useStyleStore';
import { engine_version, initEngine, InputState } from './psychro';

export function App() {
  const t = useT();
  const { theme, toggleTheme } = useTheme();

  const [engineReady, setEngineReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId>('select');

  const project = useProjectStore();
  const psych = usePsychStore();
  const style = useStyleStore();

  const altitudeM = altitudeInMetres(project);
  const resolved = useResolvedPoints(psych.points, {
    isSi: project.isSi,
    altitudeM,
    realGas: project.realGas,
    layout: project.layout,
  });
  const selected = selectedPoint(psych);
  const selectedResolved = resolved.find((r) => r.point.id === psych.selectedId) ?? null;

  // The canvas hands its transform up so the toolbox can drive zoom and fit.
  // A ref rather than state: the transform changes on every pan, and storing it
  // in state would re-render the whole shell on the 60 FPS path.
  const transform = useRef<ChartTransform | null>(null);
  const onTransformReady = useCallback((next: ChartTransform) => {
    transform.current = next;
  }, []);
  const onViewAction = useCallback((action: ViewActionId) => {
    const view = transform.current;
    if (!view) return;
    if (action === 'zoomIn') view.zoomIn();
    else if (action === 'zoomOut') view.zoomOut();
    else view.fit();
  }, []);

  useEffect(() => {
    initEngine().then(
      () => setEngineReady(true),
      (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const { addPoint, updatePoint, selectPoint, removePoint } = psych;

  /** A drag or a click writes the position as the two inputs that define it. */
  const onMovePoint = useCallback(
    (id: string, dryBulb: number, humidityRatio: number) => {
      updatePoint(id, {
        dryBulb,
        mode: InputState.DbtHumidityRatio,
        secondValue: humidityRatio,
      });
    },
    [updatePoint],
  );

  const onPlacePoint = useCallback(
    (dryBulb: number, humidityRatio: number) => {
      addPoint({
        label: nextLabel(usePsychStore.getState().points),
        dryBulb,
        mode: InputState.DbtHumidityRatio,
        secondValue: humidityRatio,
      });
      // One click, one point: drop back to Select so the next click does not
      // scatter markers across the chart.
      setTool('select');
    },
    [addPoint],
  );

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
          projectName={project.name || t('app.untitledProject')}
          isSi={project.isSi}
          onUnitChange={project.setIsSi}
          altitude={project.altitude}
          onAltitudeChange={project.setAltitude}
          theme={theme}
          onThemeToggle={toggleTheme}
          layout={project.layout}
          onLayoutChange={project.setLayout}
          engineVersion={engineReady ? engine_version() : null}
        />
      }
      toolbox={
        <Toolbox activeTool={tool} onToolChange={setTool} onViewAction={onViewAction} />
      }
      viewport={
        <Viewport>
          {engineReady ? (
            <ChartCanvas
              domain={DEFAULT_DOMAIN}
              layout={project.layout}
              altitudeM={altitudeM}
              altitude={Number(project.altitude) || 0}
              realGas={project.realGas}
              isSi={project.isSi}
              points={resolved}
              selectedId={psych.selectedId}
              visible={style.visible}
              showLabels={style.showLabels}
              showCrosshair={style.showCrosshair && tool === 'crosshair'}
              placing={tool === 'addPoint'}
              onMovePoint={onMovePoint}
              onSelectPoint={selectPoint}
              onPlacePoint={onPlacePoint}
              onTransformReady={onTransformReady}
            />
          ) : null}
        </Viewport>
      }
      panel={
        <PropertiesPanel
          point={selected}
          resolved={selectedResolved}
          isSi={project.isSi}
          realGas={project.realGas}
          onRealGasChange={project.setRealGas}
          onChange={(patch) => selected && updatePoint(selected.id, patch)}
          onAdd={() =>
            addPoint({
              label: nextLabel(psych.points),
              dryBulb: project.isSi ? 24 : 75,
              mode: InputState.DbtRh,
              secondValue: 50,
            })
          }
          onRemove={() => selected && removePoint(selected.id)}
        />
      }
    />
  );
}
