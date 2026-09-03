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

import { ChartCanvas, type DrawEndpoint } from './chart/ChartCanvas';
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
import { DocumentOutline } from './shell/DocumentOutline';
import { PALETTE, SchematicCanvas } from './schematic/SchematicCanvas';
import { useSchematicStore } from './store/useSchematicStore';
import { PROCESS_KINDS, ProcessSection } from './shell/ProcessSection';
import { PropertiesPanel } from './shell/PropertiesPanel';
import { Toolbox, type PanelId, type ToolId, type ViewActionId } from './shell/Toolbox';
import { TopNav, type FileActionId } from './shell/TopNav';
import { Viewport } from './shell/Viewport';
import { useTheme } from './shell/useTheme';
import { useT } from './i18n/useT';
import { altitudeInMetres, useProjectStore } from './store/useProjectStore';
import { useProcessStore, type Process, type ProcessKind } from './store/useProcessStore';
import {
  nextLabel,
  producerOf,
  selectedPoint,
  tearOf,
  usePsychStore,
} from './store/usePsychStore';
import { convertForUnits, specificVolumeSi } from './units';
import { useResolvedDocument } from './store/useResolvedDocument';
import {
  addProcessFrom,
  adoptFit,
  connect,
  linkPoints,
  materialiseCycle,
  removePoint as removePointAndDependents,
  removeProcess as removeProcessAndOutlet,
  tearAt,
  untear,
  wouldCloseLoop,
} from './store/document';
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
import { WEATHER_DESIGN_SI } from './weather/design';
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
  type ProcessFitOutput,
} from './psychro';

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
  const [cycleSent, setCycleSent] = useState(false);
  /**
   * Which of the two selections was made most recently.
   *
   * Points and processes are selected independently — the process panel adds
   * "from the selected point", so choosing a process must not clear it — but the
   * circuit can only highlight one block. This says which, and it is the whole
   * of the chart-to-schematic correspondence: both views read the same two
   * selections, so picking a coil on the circuit highlights its vector on the
   * chart and picking the vector highlights the block.
   */
  const [lastSelected, setLastSelected] = useState<'point' | 'process'>('point');

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
  const schematic = useSchematicStore();

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
    altitudeM,
    isSi: project.isSi,
    binStepT: weather.binStepT,
    binStepW: weather.binStepW,
    design: WEATHER_DESIGN_SI,
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
    altitudeM,
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
  // Memoised because it is in the resolution's dependency list: a fresh object
  // literal every render would re-resolve the whole document every render.
  const messages = useMemo(
    () => ({
      missingPoint: t('process.missingPoint'),
      circular: t('process.circular'),
      unresolvedProcess: t('process.unresolvedOutlet'),
    }),
    [t],
  );

  // One resolution for the whole document, in dependency order. Points and
  // processes cannot be resolved separately any more: a process may place a
  // point, and that point may be the next process's inlet.
  const document = useResolvedDocument(psych.points, proc.processes, {
    ...resolveContext,
    messages,
  });
  const resolved = document.points;
  const resolvedProcesses = document.processes;

  const selected = selectedPoint(psych);
  const selectedResolved = selected
    ? (document.pointsById.get(selected.id) ?? null)
    : null;
  const selectedProcess = proc.processes.find((p) => p.id === proc.selectedId) ?? null;
  const selectedProcessResolved = proc.selectedId
    ? (document.processesById.get(proc.selectedId) ?? null)
    : null;
  // The inlet's specific volume, so a flow may be entered volumetrically:
  // ṁ = V̇ / v_da, on the inlet's own state rather than on a nominal density.
  const inletSpecificVolume = specificVolumeSi(
    (selectedProcess
      ? document.pointsById.get(selectedProcess.fromId)?.state?.specific_volume
      : null) ?? null,
    project.isSi,
  );

  /**
   * The document edits that touch both stores, with the resolution they need.
   *
   * A detach has to know where the point currently *is*, and only the
   * resolution knows that — so the actions take it rather than guessing.
   */
  const actions = useMemo(
    () => ({
      isSi: project.isSi,
      stateOf: (id: string) => document.pointsById.get(id)?.state ?? null,
    }),
    [project.isSi, document],
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

  const { addPoint, updatePoint } = psych;

  /** Selects a point, and remembers that a point is what was selected. */
  const selectPoint = useCallback(
    (id: string | null) => {
      psych.selectPoint(id);
      setLastSelected('point');
    },
    [psych],
  );

  /** Selects a process, and remembers that a process is what was selected. */
  const selectProcess = useCallback(
    (id: string | null) => {
      proc.selectProcess(id);
      setLastSelected('process');
    },
    [proc],
  );

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
            schematic: {
              positions: useSchematicStore.getState().positions,
              passThroughs: useSchematicStore.getState().passThroughs,
            },
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
          useSchematicStore.getState().replaceAll(snapshot.schematic);
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
            // Which of the two axes carries humidity ratio.
            layout: project.layout,
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
  /**
   * Deleting a point takes the train downstream of it.
   *
   * Nothing downstream had another source, so leaving it behind would draw a
   * coil from a state that no longer exists. `document.ts` walks the graph
   * forward and says so in one place.
   */
  const onRemovePoint = useCallback(() => {
    if (!selected) return;
    removePointAndDependents(selected.id);
  }, [selected]);

  /**
   * The process that places the selected point, when one does.
   *
   * Named by its kind rather than by its id, because "placed by pr-3" tells a
   * reader nothing and "placed by Cooling coil (ADP + bypass)" tells them where
   * to go.
   */
  const selectedProducer = useMemo(() => {
    const producer = selected ? producerOf(selected) : null;
    if (!producer) return null;
    const process = proc.processes.find((p) => p.id === producer);
    if (!process) return null;
    const key = PROCESS_KINDS.find(([k]) => k === process.kind)?.[1];
    return { id: process.id, label: key ? t(key) : process.kind };
  }, [selected, proc.processes, t]);

  /**
   * Whether dragging the selected point can be inverted into its process.
   *
   * The single-parameter kinds can: one position recovers one number. Mixing and
   * recovery cannot, because their outlet is fixed by two, and a drag that
   * silently moved one of them would be worse than a drag that does nothing.
   */
  const selectedDragInvertible = useMemo(() => {
    if (!selectedProducer) return false;
    const process = proc.processes.find((p) => p.id === selectedProducer.id);
    return (
      process?.kind === 'sensible' ||
      process?.kind === 'steam' ||
      process?.kind === 'cooling'
    );
  }, [selectedProducer, proc.processes]);

  /**
   * Puts the solved cycle into the document.
   *
   * The states go in as the (dry bulb, humidity ratio) pairs the macro produced
   * — exact, and the one pair every resolved state carries — and the coil goes
   * in as its apparatus dew point and bypass factor, which is what keeps the
   * cycle *alive*: change the outdoor fraction on the mixing process and the
   * mixed state moves, and the coil follows it.
   */
  const onSendCycleToChart = useCallback(() => {
    if (!cycle) return;
    materialiseCycle(
      {
        // As the case states them — dry bulb and relative humidity — rather
        // than as states resolved from them.
        outdoor: {
          dryBulb: design.outdoorT,
          mode: InputState.DbtRh,
          secondValue: design.outdoorRh,
        },
        room: {
          dryBulb: design.roomT,
          mode: InputState.DbtRh,
          secondValue: design.roomRh,
        },
        adp: cycle.coil.adp.dbt,
        bypassFactor: cycle.coil.bf_humidity_ratio,
        mdotOutdoor: cycle.mdot_outdoor,
        mdotSupply: cycle.mdot_supply,
        outdoorLabel: t('design.blockOutdoor'),
        roomLabel: t('design.blockRoom'),
        mixedLabel: t('design.blockMixing'),
        supplyLabel: t('design.blockFan'),
      },
      actions,
    );
    setCycleSent(true);
    setPage('chart');
  }, [cycle, design, t, actions]);

  /**
   * Places a block dragged out of the palette.
   *
   * Dropped onto a block, it takes that block's outlet as its inlet, which is
   * how a train is built by dragging: drop a coil on the mixing box and the air
   * runs through the box into the coil. Dropped on empty canvas it starts from
   * whatever is selected, or from the last state in the document — a block with
   * no inlet is not a process, so it has to start somewhere.
   *
   * The position is stored straight away, so the block stays where it was
   * dropped rather than being swept into the automatic layout.
   */
  const onDropBlock = useCallback(
    (kind: ProcessKind, at: { x: number; y: number }, afterId: string | null) => {
      const processes = useProcessStore.getState().processes;
      const dropped = processes.find((p) => p.id === afterId);
      const fromId =
        dropped?.toId ??
        (afterId && usePsychStore.getState().points.some((p) => p.id === afterId)
          ? afterId
          : null) ??
        selected?.id ??
        usePsychStore.getState().points.at(-1)?.id;
      if (!fromId) return;

      const id = addProcessFrom(fromId, kind, actions);
      useSchematicStore.getState().setPosition(id, at);
    },
    [selected, actions],
  );

  /**
   * Wires one block into another on the schematic.
   *
   * A connection that closes a loop is not refused: a loop is a *circuit*, which
   * is what the user is drawing. It is torn instead — the stream becomes
   * specified rather than computed — which is both what lets the document
   * resolve in one pass and what a designer means when they state a return-air
   * condition.
   */
  const onConnectBlocks = useCallback(
    (outletPointId: string, intoProcessId: string, slot: 'from' | 'second') => {
      const closes = wouldCloseLoop(outletPointId, intoProcessId);
      connect(outletPointId, intoProcessId, slot);
      if (!closes) return;
      const producer = useProcessStore
        .getState()
        .processes.find(
          (p) => p.toId === outletPointId || p.toSecondId === outletPointId,
        );
      if (producer) tearAt(outletPointId, producer.id, actions);
    },
    [actions],
  );

  /**
   * Offers to specify the selected point, when doing so would cut a loop.
   *
   * Only offered where it would *do* something: a derived point that nothing
   * feeds back into is already computed in order, and specifying it would trade
   * a correct number for a typed one.
   */
  const selectedTearable = useMemo(() => {
    const producer = selected ? producerOf(selected) : null;
    if (!producer || !selected) return null;
    const feedsUpstream = proc.processes.some(
      (p) =>
        (p.fromId === selected.id || p.secondId === selected.id) &&
        wouldCloseLoop(selected.id, p.id),
    );
    if (!feedsUpstream) return null;
    return () => tearAt(selected.id, producer, actions);
  }, [selected, proc.processes, actions]);

  /** Breaks a derived point's link to its process, keeping it where it is. */
  const onDetachPoint = useCallback(() => {
    if (!selected) return;
    const state = document.pointsById.get(selected.id)?.state;
    if (!state) return;
    usePsychStore.getState().detachPoint(selected.id, {
      dryBulb: state.dbt,
      mode: InputState.DbtHumidityRatio,
      secondValue: state.humidity_ratio,
    });
  }, [selected, document]);

  /**
   * Turns an identified line into the parametric process it was identified as.
   *
   * The parameters come from the engine's own back-solve rather than from
   * anything re-derived here, which is what makes the adopted process land
   * exactly where the line already was.
   */
  const onAdoptFit = useCallback(
    (kind: ProcessKind, fit: ProcessFitOutput) => {
      if (!selectedProcess) return;
      const endpoint = document.pointsById.get(selectedProcess.secondId ?? '')?.state;
      const parameters: Partial<Process> =
        kind === 'sensible'
          ? { targetT: endpoint?.dbt ?? 0 }
          : kind === 'steam'
            ? {
                targetW: endpoint?.humidity_ratio ?? 0,
                steamEnthalpy: fit.steam_enthalpy,
              }
            : { effectiveness: fit.effectiveness };
      adoptFit(selectedProcess.id, kind, parameters);
    },
    [selectedProcess, document],
  );

  /**
   * A drag or a click writes the position as the two inputs that define it.
   *
   * A **derived** point has no inputs to write: it is placed by its process, so
   * the drag is inverted into that process's own parameter instead. One
   * position cannot recover two numbers, so the kinds fixed by two parameters —
   * mixing, recovery — decline and say which field to edit.
   */
  const onMovePoint = useCallback(
    (id: string, dryBulb: number, humidityRatio: number) => {
      const point = usePsychStore.getState().points.find((p) => p.id === id);
      const producer = point ? producerOf(point) : null;
      if (producer) {
        const process = useProcessStore
          .getState()
          .processes.find((p) => p.id === producer);
        if (!process) return;
        if (process.kind === 'sensible') {
          useProcessStore.getState().updateProcess(producer, { targetT: dryBulb });
        } else if (process.kind === 'steam') {
          useProcessStore.getState().updateProcess(producer, { targetW: humidityRatio });
        } else if (process.kind === 'cooling') {
          useProcessStore.getState().updateProcess(producer, { tAdp: dryBulb });
        }
        // Every other kind keeps its outlet where the physics puts it. The
        // panel explains; the marker simply does not follow the pointer.
        return;
      }
      updatePoint(id, {
        dryBulb,
        mode: InputState.DbtHumidityRatio,
        secondValue: humidityRatio,
      });
    },
    [updatePoint],
  );

  /**
   * A process drawn on the chart, from one end to the other.
   *
   * The gesture the toolbox offered and nothing implemented. Either end may be
   * a point that already exists or open chart; open chart becomes a new point,
   * because a process has to join two *states* and an unnamed one cannot be
   * edited afterwards.
   *
   * The result is a fitted process: the engine names it and backs out its
   * parameters, and the panel offers to adopt them. Guessing a parametric kind
   * from the direction of a drag would be the tool deciding what the user meant.
   */
  const onDrawProcess = useCallback(
    (from: DrawEndpoint, to: DrawEndpoint) => {
      const materialise = (end: DrawEndpoint) =>
        end.pointId ??
        addPoint({
          label: nextLabel(usePsychStore.getState().points),
          dryBulb: end.dryBulb,
          mode: InputState.DbtHumidityRatio,
          secondValue: end.humidityRatio,
        });

      const fromId = materialise(from);
      const toId = materialise(to);
      const id = linkPoints(fromId, toId, {
        isSi: project.isSi,
        // The points may have just been created, so the resolution in hand
        // predates them; the engine's own defaults do not depend on the inlet
        // for a fitted line.
        stateOf: () => null,
      });
      selectProcess(id);
      // One gesture, one process: drop back to Select so the next drag pans the
      // view rather than scattering lines across the chart.
      setTool('select');
    },
    [addPoint, project.isSi, selectProcess],
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
              weather.setForUnits(next);
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
          onSendToChart={onSendCycleToChart}
          sent={cycleSent}
          palette={
            <>
              <h2 className="panel__section">{t('schematic.palette')}</h2>
              <div className="palette">
                {PALETTE.map(([kind, key]) => (
                  <button
                    key={kind}
                    type="button"
                    className="palette__item"
                    disabled={psych.points.length === 0}
                    // Draggable *and* clickable. Dragging is the gesture the
                    // canvas is for; a click still works, because a drag is a
                    // poor thing to require of a keyboard or a trackpad, and
                    // dropping onto empty canvas does the same thing anyway.
                    draggable={psych.points.length > 0}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/psypro-block', kind);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => {
                      const from = selected ?? psych.points[psych.points.length - 1];
                      if (from) addProcessFrom(from.id, kind as ProcessKind, actions);
                    }}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
              <p className="panel__note">
                {psych.points.length === 0
                  ? t('schematic.empty')
                  : t('schematic.paletteHint')}
              </p>
            </>
          }
          canvas={
            <SchematicCanvas
              points={psych.points}
              processes={proc.processes}
              passThroughs={schematic.passThroughs}
              positions={schematic.positions}
              resolvedPoints={document.pointsById}
              resolvedProcesses={document.processesById}
              kindLabel={(process) => {
                const key = PROCESS_KINDS.find(([k]) => k === process.kind)?.[1];
                return key ? t(key) : process.kind;
              }}
              selectedId={lastSelected === 'process' ? proc.selectedId : psych.selectedId}
              isSi={project.isSi}
              onSelectProcess={selectProcess}
              onSelectPoint={selectPoint}
              onMove={schematic.setPositions}
              onConnect={onConnectBlocks}
              onDrop={onDropBlock}
              onDelete={(node) => {
                if (node.kind === 'process') removeProcessAndOutlet(node.id, actions);
                else if (node.kind === 'boundary') removePointAndDependents(node.id);
                else schematic.removePassThrough(node.id);
              }}
            />
          }
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
                  onSelectProcess={selectProcess}
                  protractor={protractor}
                  envelopes={envelopes}
                  weatherBins={weather.result?.bins ?? null}
                  visible={style.visible}
                  styles={style.styles}
                  showLabels={style.showLabels}
                  showCrosshair={style.showCrosshair && tool === 'crosshair'}
                  placing={tool === 'addPoint'}
                  drawing={tool === 'drawProcess'}
                  onDrawProcess={onDrawProcess}
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
              outline={
                <DocumentOutline
                  points={psych.points}
                  processes={proc.processes}
                  resolvedPoints={document.pointsById}
                  resolvedProcesses={document.processesById}
                  kindLabel={(process) => {
                    const key = PROCESS_KINDS.find(([k]) => k === process.kind)?.[1];
                    return key ? t(key) : process.kind;
                  }}
                  selectedPointId={psych.selectedId}
                  selectedProcessId={proc.selectedId}
                  isSi={project.isSi}
                  onSelectPoint={selectPoint}
                  onSelectProcess={selectProcess}
                />
              }
              producedBy={selectedProducer}
              dragInvertible={selectedDragInvertible}
              torn={selected ? tearOf(selected) !== null : false}
              onTear={selectedTearable ?? undefined}
              onUntear={
                selected && tearOf(selected) !== null
                  ? () => untear(selected.id)
                  : undefined
              }
              onDetach={onDetachPoint}
              onSelectProducer={selectProcess}
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
                  fromLabel={(selected ?? psych.points[0])?.label ?? null}
                  onAdopt={onAdoptFit}
                  onSelectPoint={selectPoint}
                  onChange={(patch) =>
                    selectedProcess && proc.updateProcess(selectedProcess.id, patch)
                  }
                  onAdd={(kind: ProcessKind) => {
                    // The inlet is the selected point, and the button is
                    // disabled without one — no more guessing at `points[0]`
                    // and giving the user a process bound to something they
                    // cannot see.
                    const from = selected ?? psych.points[0];
                    if (from) addProcessFrom(from.id, kind, actions);
                  }}
                  onLink={(secondId: string) => {
                    if (selected) linkPoints(selected.id, secondId, actions);
                  }}
                  onRemove={() =>
                    selectedProcess && removeProcessAndOutlet(selectedProcess.id, actions)
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
