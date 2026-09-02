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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChartCanvas } from './chart/ChartCanvas';
import type { GridCurve } from './chart/useBaseGrid';
import type { Viewport as ChartViewport } from './chart/geometry';
import type { ChartTokens } from './chart/useChartTokens';
import { DEFAULT_DOMAIN } from './chart/useBaseGrid';
import type { ChartTransform } from './chart/useChartTransform';
import { ChartPage } from './pages/ChartPage';
import { DataTablePage } from './pages/DataTablePage';
import { ProcessDesignPage } from './pages/ProcessDesignPage';
import { WeatherPage } from './pages/WeatherPage';
import { AppShell } from './shell/AppShell';
import { LayerOptions } from './shell/LayerOptions';
import { StyleModal } from './shell/StyleModal';
import { PageTabs, type PageId } from './shell/PageTabs';
import { TeachingPanel } from './shell/TeachingPanel';
import { ProcessSection } from './shell/ProcessSection';
import { PropertiesPanel } from './shell/PropertiesPanel';
import { Toolbox, type PanelId, type ToolId, type ViewActionId } from './shell/Toolbox';
import { TopNav, type FileActionId } from './shell/TopNav';
import { Viewport } from './shell/Viewport';
import { useTheme } from './shell/useTheme';
import { useT } from './i18n/useT';
import { altitudeInMetres, useProjectStore } from './store/useProjectStore';
import {
  defaultProcess,
  useProcessStore,
  type ProcessKind,
} from './store/useProcessStore';
import { nextLabel, selectedPoint, usePsychStore } from './store/usePsychStore';
import { useResolvedPoints } from './store/useResolvedPoints';
import { convertForUnits, specificVolumeSi } from './units';
import { useResolvedProcesses } from './store/useResolvedProcesses';
import { envelopeById, exampleById } from './data';
import { chartToDxf } from './export/dxf';
import { chartToSvg } from './export/svg';
import { pointsToCsv } from './export/csv';
import { deserialise, serialise } from './project/format';
import { download, openText, saveText, type FileHandle } from './project/files';
import { formatProperties } from './chart/format';
import { useCycleStore } from './store/useCycleStore';
import { useProfileStore } from './store/useProfileStore';
import { useWeatherStore } from './store/useWeatherStore';
import { useWeatherLoader } from './weather/useWeatherLoader';
import type { EnvelopeBounds } from './weather/epw.worker';
import { useStyleStore, type FamilyStyle } from './store/useStyleStore';
import {
  calculate_state,
  ChartLayout,
  engine_version,
  explain_state,
  initEngine,
  measure_real_gas_correction,
  protractor_slope,
  solve_return_air_cycle,
  InputState,
  StatePointInput,
  type CurveFamilyId,
  type CycleOutput,
} from './psychro';

/**
 * The free-cooling design the weather hour counts are taken against.
 *
 * Phase 12 makes these editable alongside the rest of the design case; for now
 * they are the comfort-cooling defaults §4.9 and §4.3 quote — 13 °C supply,
 * a 24 °C / 50% RH return, a 21 °C economiser high limit, and 300 mm rigid
 * media at 0.85 wet-bulb depression effectiveness.
 */
const WEATHER_DESIGN = {
  tSupply: 13,
  hReturn: 47.9,
  tHighLimit: 21,
  evaporative: 0.85,
};

/** The export formats on offer, in the order §12 lists them. */
const EXPORT_FORMATS = [
  { id: 'svg', label: 'SVG' },
  { id: 'dxf', label: 'DXF' },
  { id: 'csv', label: 'CSV' },
];

/**
 * Site elevation across a unit switch. Kept as text, because the field is text
 * and an empty box mid-edit must not become a zero-metre site.
 */
function convertAltitude(altitude: string, toSi: boolean): string {
  const parsed = Number(altitude.trim());
  if (altitude.trim() === '' || !Number.isFinite(parsed)) return altitude;
  return String(Number(convertForUnits('length', parsed, toSi).toFixed(4)));
}

export function App() {
  const t = useT();
  const { theme, toggleTheme } = useTheme();

  const [engineReady, setEngineReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId>('select');
  const [page, setPage] = useState<PageId>('chart');
  const [rightPanel, setRightPanel] = useState<PanelId>('properties');
  const [showStyles, setShowStyles] = useState(false);
  const [exampleId, setExampleId] = useState<string | null>(null);
  const [fileHandle, setFileHandle] = useState<FileHandle>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  /**
   * The last state the canvas drew, kept for export.
   *
   * A ref rather than lifted state: it changes on every pan, and an export
   * happens once. Storing it in state would re-render the shell at 60 FPS to
   * serve a button nobody has pressed.
   */
  const drawn = useRef<{
    curves: GridCurve[];
    viewport: ChartViewport;
    tokens: ChartTokens;
    styles: Record<CurveFamilyId, FamilyStyle>;
    width: number;
    height: number;
  } | null>(null);

  const project = useProjectStore();
  const psych = usePsychStore();
  const style = useStyleStore();
  const proc = useProcessStore();
  const design = useCycleStore();
  const profile = useProfileStore();
  const weather = useWeatherStore();

  /** The envelopes the active profile and the layer toggles between them show. */
  const envelopes = profile.visibleEnvelopes.flatMap((id) => {
    const e = envelopeById(id);
    return e ? [e] : [];
  });

  const altitudeM = altitudeInMetres(project);
  const altitude = Number(project.altitude) || 0;

  /**
   * The weather worker, and the context it analyses against.
   *
   * Everything the year is asked — resolve, bin, count — happens in the worker.
   * A trace of the first version, which did it here, measured 39 seconds of
   * blocked main thread on one 8760-hour file.
   */
  const weatherContext = {
    altitude,
    isSi: project.isSi,
    binStepT: weather.binStepT,
    binStepW: weather.binStepW,
    design: WEATHER_DESIGN,
    envelopes: envelopes.map((e) => ({
      id: e.id,
      bounds: [
        e.limits.tMin,
        e.limits.tMax,
        e.limits.dpMin ?? Number.NaN,
        e.limits.dpMax ?? Number.NaN,
        e.limits.rhMin ?? Number.NaN,
        e.limits.rhMax ?? Number.NaN,
        e.limits.wMin ?? Number.NaN,
        e.limits.wMax ?? Number.NaN,
      ] as EnvelopeBounds,
    })),
  };
  const { load: loadWeather, reanalyse } = useWeatherLoader(weatherContext);

  // Re-run the analysis when what it depends on moves. Not on every render:
  // the dependency list is the physics and the bin increments, and nothing else.
  const envelopeKey = envelopes.map((e) => e.id).join(',');
  useEffect(() => {
    reanalyse();
  }, [
    reanalyse,
    altitude,
    project.isSi,
    weather.binStepT,
    weather.binStepW,
    envelopeKey,
  ]);

  const resolveContext = {
    isSi: project.isSi,
    altitude,
    altitudeM,
    realGas: project.realGas,
    layout: project.layout,
  };
  const resolved = useResolvedPoints(psych.points, resolveContext);
  const selected = selectedPoint(psych);
  const selectedResolved = resolved.find((r) => r.point.id === psych.selectedId) ?? null;

  // A Map keyed by id, memoised so the process resolution's dependency list is
  // stable across renders that did not touch the points.
  const pointsById = useMemo(
    () => new Map(psych.points.map((p) => [p.id, p])),
    [psych.points],
  );
  const missingPointMessage = t('process.missingPoint');
  const resolvedProcesses = useResolvedProcesses(proc.processes, {
    ...resolveContext,
    points: pointsById,
    missingPointMessage,
  });
  const selectedProcess = proc.processes.find((p) => p.id === proc.selectedId) ?? null;
  const selectedProcessResolved =
    resolvedProcesses.find((r) => r.process.id === proc.selectedId) ?? null;
  // The inlet's specific volume, so a flow may be entered volumetrically:
  // ṁ = V̇ / v_da, on the inlet's own state rather than on a nominal density.
  const inletSpecificVolume = specificVolumeSi(
    resolved.find((r) => r.point.id === selectedProcess?.fromId)?.state?.specific_volume ??
      null,
    project.isSi,
  );

  /**
   * The SHR reference line, drawn through the selected process's inlet.
   *
   * `slope` is `NaN` at SHR = 1 — no moisture moves, so there is no finite
   * enthalpy-per-moisture slope — and the renderer takes `null` to mean exactly
   * that and draws the horizontal line it is. Drawing nothing there would hide
   * the data-centre case, which is a real design.
   */
  const protractor = useMemo(() => {
    const r = selectedProcessResolved;
    if (!r?.load?.has_shr || !r.from) return null;
    const slope = protractor_slope(r.load.shr);
    return { slope: Number.isFinite(slope) ? slope : null, through: r.from };
  }, [selectedProcessResolved]);

  /**
   * The primary return-air cycle, solved from the design case.
   *
   * Derived like everything else: the store holds eight numbers, and every
   * intermediate state comes back from the engine. An unsolvable case — supply
   * air warmer than the room, say — is an ordinary outcome that the page
   * reports, not an exception.
   */
  const [cycle, cycleError] = useMemo<[CycleOutput | null, string | null]>(() => {
    if (!engineReady) return [null, null];
    try {
      const point = (dbt: number, rh: number) =>
        new StatePointInput(
          dbt,
          rh,
          InputState.DbtRh,
          altitude,
          project.isSi,
          project.realGas,
        );
      return [
        solve_return_air_cycle(
          point(design.outdoorT, design.outdoorRh),
          point(design.roomT, design.roomRh),
          design.qSensible,
          design.qLatent,
          design.supplyT,
          design.outdoorFraction,
        ),
        null,
      ];
    } catch (e: unknown) {
      return [null, e instanceof Error ? e.message : String(e)];
    }
  }, [
    engineReady,
    altitude,
    project.isSi,
    project.realGas,
    design.outdoorT,
    design.outdoorRh,
    design.roomT,
    design.roomRh,
    design.qSensible,
    design.qLatent,
    design.supplyT,
    design.outdoorFraction,
  ]);

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

  /**
   * The working behind the selected state, and the size of the real-gas
   * correction at it.
   *
   * Both come from the engine: it is the only thing that knows what was
   * substituted, and re-deriving the intermediates here to display them would be
   * a second implementation of the physics in the one place where a divergence
   * would actively teach the wrong thing.
   */
  const working = useMemo(() => {
    if (!engineReady || !selected) return { steps: [], correction: null };
    try {
      const input = () =>
        new StatePointInput(
          selected.dryBulb,
          selected.secondValue,
          selected.mode,
          altitude,
          project.isSi,
          project.realGas,
        );
      const state = calculate_state(input());
      return {
        steps: explain_state(input()),
        correction: (() => {
          try {
            const c = measure_real_gas_correction(
              state.dbt,
              state.rh,
              altitude,
              project.isSi,
            );
            return { wReal: c.w_real, wIdeal: c.w_ideal, percent: c.percent };
          } catch {
            return null;
          }
        })(),
      };
    } catch {
      return { steps: [], correction: null };
    }
  }, [engineReady, selected, altitude, project.isSi, project.realGas]);

  const { addPoint, updatePoint, selectPoint, removePoint } = psych;

  /** Save, open, and the export menu. */
  const onFileAction = useCallback(
    (action: FileActionId) => {
      setFileError(null);
      if (action === 'save') {
        const text = serialise(
          {
            name: project.name,
            isSi: project.isSi,
            altitude: project.altitude,
            layout: project.layout,
            realGas: project.realGas,
            points: usePsychStore.getState().points,
            processes: useProcessStore.getState().processes,
          },
          engineReady ? engine_version() : 'unknown',
        );
        saveText(text, `${project.name || 'project'}.psy`, fileHandle)
          .then(setFileHandle)
          .catch((e: unknown) => {
            // A cancelled picker is not an error; anything else is.
            if (e instanceof DOMException && e.name === 'AbortError') return;
            setFileError(e instanceof Error ? e.message : String(e));
          });
        return;
      }

      openText()
        .then((opened) => {
          if (!opened) return;
          const snapshot = deserialise(opened.text);
          project.setIsSi(snapshot.isSi);
          project.setAltitude(snapshot.altitude);
          project.setLayout(snapshot.layout);
          project.setRealGas(snapshot.realGas);
          project.setName(snapshot.name);
          usePsychStore.getState().replaceAll(snapshot.points);
          useProcessStore.getState().replaceAll(snapshot.processes);
          setFileHandle(opened.handle);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          setFileError(e instanceof Error ? e.message : String(e));
        });
    },
    [project, fileHandle, engineReady],
  );

  const onExport = useCallback(
    (format: string) => {
      const name = project.name || 'chart';
      if (format === 'csv') {
        const csv = pointsToCsv(resolved, (p) =>
          formatProperties(p.state!, project.isSi, t),
        );
        if (csv) download(csv, `${name}.csv`, 'text/csv');
        return;
      }
      const state = drawn.current;
      if (!state) return;
      if (format === 'svg') {
        download(
          chartToSvg({
            ...state,
            points: resolved,
            processes: resolvedProcesses,
            title: project.name || t('app.untitledProject'),
            subtitle: t('export.subtitle', {
              altitude: project.altitude,
              unit: t(project.isSi ? 'unit.metre' : 'unit.foot'),
              layout: t(
                project.layout === ChartLayout.Ashrae
                  ? 'layout.ashrae'
                  : 'layout.mollier',
              ),
            }),
          }),
          `${name}.svg`,
          'image/svg+xml',
        );
      } else {
        download(
          chartToDxf({
            curves: state.curves,
            points: resolved,
            processes: resolvedProcesses,
            // Puts the two axes on comparable footing: 60 units against 0.03 is
            // an unusable drawing whatever the numbers mean.
            humidityScale: 1000,
          }),
          `${name}.dxf`,
          'application/dxf',
        );
      }
    },
    [project, resolved, resolvedProcesses, t],
  );

  /** Loads a worked example as the selected point. */
  const loadExample = useCallback(
    (id: string) => {
      const example = exampleById(id);
      if (!example) return;
      const modes = {
        rh: InputState.DbtRh,
        wb: InputState.DbtWbt,
        dp: InputState.DbtDewPoint,
        w: InputState.DbtHumidityRatio,
        h: InputState.DbtEnthalpy,
      } as const;
      // The example states its elevation in metres; the document may be in feet,
      // and the example's numbers were published at that elevation.
      project.setIsSi(true);
      project.setAltitude(String(example.state.altitudeM));
      psych.addPoint({
        label: nextLabel(usePsychStore.getState().points),
        dryBulb: example.state.dryBulb,
        mode: modes[example.state.mode],
        secondValue: example.state.value,
      });
      setExampleId(id);
    },
    [project, psych],
  );
  const { removeForPoint } = proc;

  /** Deleting a point takes its processes with it. */
  const onRemovePoint = useCallback(() => {
    if (!selected) return;
    removeForPoint(selected.id);
    removePoint(selected.id);
  }, [selected, removeForPoint, removePoint]);

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
          onUnitChange={(next: boolean) => {
            // The whole document holds quantities, not labels: switching to IP
            // has to convert them, or a 24 °C room silently becomes a 24 °F one
            // and every point on the chart moves. Points, processes, the design
            // case and the site elevation all go across together.
            if (next !== project.isSi) {
              design.setForUnits(next);
              psych.setForUnits(next);
              proc.setForUnits(next);
              project.setAltitude(convertAltitude(project.altitude, next));
            }
            project.setIsSi(next);
          }}
          altitude={project.altitude}
          onAltitudeChange={project.setAltitude}
          theme={theme}
          onThemeToggle={toggleTheme}
          layout={project.layout}
          onLayoutChange={project.setLayout}
          engineVersion={engineReady ? engine_version() : null}
          onFileAction={onFileAction}
          exportFormats={EXPORT_FORMATS}
          onExport={onExport}
        />
      }
      tabs={
        <>
          <PageTabs active={page} onChange={setPage} unavailable={['report']} />
          {/* A save that fails silently is worse than one that fails loudly:
              the user walks away believing their work is on disk. */}
          {fileError ? (
            <p className="banner" role="alert">
              {fileError}
            </p>
          ) : null}
        </>
      }
      toolbox={
        <Toolbox
          activeTool={tool}
          onToolChange={setTool}
          onViewAction={onViewAction}
          panel={rightPanel}
          onPanelChange={setRightPanel}
        />
      }
    >
      {page === 'design' ? (
        <ProcessDesignPage
          design={design}
          onChange={design.set}
          cycle={cycle}
          error={cycleError}
          isSi={project.isSi}
        />
      ) : page === 'weather' ? (
        <WeatherPage
          result={weather.result}
          loading={weather.loading}
          error={weather.error}
          onFile={loadWeather}
          binStepT={weather.binStepT}
          binStepW={weather.binStepW}
          onBinStepT={weather.setBinStepT}
          onBinStepW={weather.setBinStepW}
          isSi={project.isSi}
        />
      ) : page === 'table' ? (
        <DataTablePage points={resolved} isSi={project.isSi} />
      ) : (
        <ChartPage
          activePanel={rightPanel}
          layers={
            <LayerOptions
              visible={style.visible}
              onToggleFamily={style.toggleFamily}
              onOpenStyles={() => setShowStyles(true)}
              showLabels={style.showLabels}
              onShowLabels={style.setShowLabels}
              profileId={profile.profileId}
              onProfileChange={profile.setProfile}
              visibleEnvelopes={profile.visibleEnvelopes}
              onToggleEnvelope={profile.toggleEnvelope}
            />
          }
          viewport={
            <Viewport>
              {engineReady ? (
                <ChartCanvas
                  domain={DEFAULT_DOMAIN}
                  layout={project.layout}
                  altitudeM={altitudeM}
                  altitude={altitude}
                  realGas={project.realGas}
                  isSi={project.isSi}
                  points={resolved}
                  selectedId={psych.selectedId}
                  processes={resolvedProcesses}
                  selectedProcessId={proc.selectedId}
                  onSelectProcess={proc.selectProcess}
                  protractor={protractor}
                  envelopes={envelopes}
                  weatherBins={weather.result?.bins ?? null}
                  visible={style.visible}
                  styles={style.styles}
                  showLabels={style.showLabels}
                  showCrosshair={style.showCrosshair && tool === 'crosshair'}
                  placing={tool === 'addPoint'}
                  onMovePoint={onMovePoint}
                  onSelectPoint={selectPoint}
                  onPlacePoint={onPlacePoint}
                  onTransformReady={onTransformReady}
                  onDrawn={(state) => (drawn.current = state)}
                />
              ) : null}
            </Viewport>
          }
          teaching={
            <TeachingPanel
              onLoadExample={loadExample}
              exampleId={exampleId}
              hasSelection={selected !== null}
              steps={working.steps}
              correction={working.correction}
            />
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
              onRemove={onRemovePoint}
              processSection={
                <ProcessSection
                  process={selectedProcess}
                  resolved={selectedProcessResolved}
                  points={psych.points}
                  isSi={project.isSi}
                  inletSpecificVolume={inletSpecificVolume}
                  canAdd={psych.points.length > 0}
                  onChange={(patch) =>
                    selectedProcess && proc.updateProcess(selectedProcess.id, patch)
                  }
                  onAdd={(kind: ProcessKind) => {
                    const from = selected ?? psych.points[0];
                    if (from) proc.addProcess(defaultProcess(kind, from.id));
                  }}
                  onRemove={() =>
                    selectedProcess && proc.removeProcess(selectedProcess.id)
                  }
                />
              }
            />
          }
        />
      )}
      {showStyles ? (
        <StyleModal
          styles={style.styles}
          onSetStyle={style.setFamilyStyle}
          onResetFamily={style.resetFamilyStyle}
          onResetAll={style.resetAllStyles}
          onClose={() => setShowStyles(false)}
        />
      ) : null}
    </AppShell>
  );
}
