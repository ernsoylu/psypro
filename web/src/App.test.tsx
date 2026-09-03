import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The generated WASM module cannot be instantiated under jsdom, so the binding
// surface is stubbed here. These tests cover the shell's contract; the
// thermodynamics are covered by the Rust conformance suite, which is where they
// belong.
vi.mock('./psychro', async () => {
  const InputState = {
    DbtWbt: 0,
    DbtRh: 1,
    DbtDewPoint: 2,
    DbtHumidityRatio: 3,
    DbtEnthalpy: 4,
  } as const;
  const ChartLayout = { Ashrae: 0, MollierIx: 1 } as const;
  // The identification's discriminant. Mirrors the generated enum's order,
  // which is what the panel maps to its translated names.
  const ProcessFitKind = {
    SensibleHeating: 0,
    SensibleCooling: 1,
    Isothermal: 2,
    Evaporative: 3,
    CoolingDehumidification: 4,
    Desiccant: 5,
    General: 6,
  } as const;
  const CurveFamilyId = {
    DryBulb: 0,
    HumidityRatio: 1,
    RelativeHumidity: 2,
    WetBulb: 3,
    Enthalpy: 4,
    SpecificVolume: 5,
  } as const;
  return {
    ChartLayout,
    CurveFamilyId,
    ProcessFitKind,
    generate_base_grid: () => [{ family: 2, value: 1, coords: [0, 0, 30, 0.03] }],
    get_chart_extent: () => ({ x_min: -10, x_max: 52, y_min: 0, y_max: 0.03 }),
    InputState,
    StatePointInput: class {
      constructor(
        public dbt: number,
        public val2: number,
        public state_type: number,
        public altitude: number,
        public is_si: boolean,
        public real_gas: boolean,
      ) {}
    },
    initEngine: () => Promise.resolve(),
    engine_version: () => '0.1.0',
    get_coordinate_mapping: () => ({ x: 24, y: 0.0093 }),
    state_from_chart_coordinates_clamped: () => ({
      clamped: false,
      state: { dbt: 24, humidity_ratio: 0.0093 },
    }),
    calculate_state: () => ({
      dbt: 24,
      wbt: 17.07,
      dew_point: 12.99,
      humidity_ratio: 0.0093,
      humidity_ratio_grains: 65.1,
      rh: 50,
      degree_of_saturation: 49.25,
      enthalpy: 47.8,
      specific_volume: 0.8544,
      density: 1.1813,
      vapor_pressure: 1.4948,
      barometric_pressure: 101.325,
      is_sub_freezing: false,
    }),
    mix_air: () => {
      throw new Error('not used in this test');
    },
    // Ten degrees on, so an outlet is distinguishable from its inlet: a train
    // that silently restarted from the wrong state would otherwise pass.
    apply_cooling: (i: { dbt: number }, tOut: number) => ({
      process: {
        outlet: {
          dbt: tOut,
          wbt: 17.07,
          dew_point: 12.99,
          humidity_ratio: 0.0093,
          humidity_ratio_grains: 65.1,
          rh: 42,
          degree_of_saturation: 41.2,
          enthalpy: 47.8,
          specific_volume: 0.8544,
          density: 1.1813,
          vapor_pressure: 1.4948,
          barometric_pressure: 101.325,
          is_sub_freezing: false,
        },
        load: { total: 10, sensible: 10, latent: 0, moisture: 0, shr: 1, has_shr: true },
        near_saturation: false,
      },
      dehumidified: false,
      condensate: 0,
      frost_risk: false,
      coil: undefined,
    }),
    // SHR = 1 has no finite slope, and the renderer takes that to mean the
    // horizontal line it is.
    protractor_slope: () => Number.POSITIVE_INFINITY,
    process_load: () => ({
      total: 10,
      sensible: 10,
      latent: 0,
      moisture: 0,
      shr: 1,
      has_shr: true,
    }),
    identify_process: () => ({
      kind: 0,
      load: { total: 10, sensible: 10, latent: 0, moisture: 0, shr: 1, has_shr: true },
      slope: Number.NaN,
      has_slope: false,
      duty: 10,
      has_duty: true,
      water_flow: Number.NaN,
      has_water_flow: false,
      steam_enthalpy: Number.NaN,
      has_steam_enthalpy: false,
      effectiveness: Number.NaN,
      has_effectiveness: false,
      enthalpy_rise: Number.NaN,
      has_enthalpy_rise: false,
    }),
  };
});

// The stores are module-level singletons, so a point added by one test would
// still be there for the next one — and "no point selected" is a state worth
// testing rather than an accident of ordering.
beforeEach(() => {
  usePsychStore.setState({ points: [], selectedId: null });
  // The processes too, now that a point can be the outlet of one: a process
  // left behind by an earlier test resolves against a document that no longer
  // contains its inlet, and shows up as a row in the next test's outline.
  useProcessStore.setState({ processes: [], selectedId: null });
  useProjectStore.setState({ isSi: true, altitude: '0', realGas: true, name: '' });
});

describe('application shell', () => {
  it('renders the four regions REQUIREMENTS §6 specifies', async () => {
    render(<App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Psychrometric chart' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Properties' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('engine 0.1.0')).toBeInTheDocument());
  });

  it('offers every tool and view control the spec lists', () => {
    render(<App />);
    const tools = within(screen.getByRole('group', { name: 'Tools' }));
    for (const name of [
      'Select',
      'Add state point',
      'Draw process line',
      'Draw shape',
      'Crosshair mode',
    ]) {
      expect(tools.getByRole('button', { name })).toBeInTheDocument();
    }
    const view = within(screen.getByRole('group', { name: 'View' }));
    for (const name of ['Zoom in', 'Zoom out', 'Fit to window']) {
      expect(view.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('marks exactly one tool active, and follows a click', async () => {
    const user = userEvent.setup();
    render(<App />);
    const tools = within(screen.getByRole('group', { name: 'Tools' }));
    const pressed = () =>
      tools
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') === 'true');

    expect(pressed()).toHaveLength(1);
    expect(pressed()[0]).toHaveAccessibleName('Select');

    await user.click(tools.getByRole('button', { name: 'Add state point' }));
    expect(pressed()).toHaveLength(1);
    expect(pressed()[0]).toHaveAccessibleName('Add state point');
  });

  it('starts with nothing selected and offers a way to add a point', async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = within(screen.getByRole('complementary', { name: 'Properties' }));
    expect(panel.getByText('No point selected')).toBeInTheDocument();

    await user.click(panel.getByRole('button', { name: 'Add state point' }));
    // Adding selects, so the panel is already editing the point you just made.
    expect(panel.getByLabelText('Point label')).toHaveValue('OA');
  });

  it('reports relative humidity and degree of saturation as separate properties', async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = within(screen.getByRole('complementary', { name: 'Properties' }));
    await user.click(panel.getByRole('button', { name: 'Add state point' }));
    // Scoped to the results table: "Relative humidity" also appears as a
    // <select> option, and the point of this test is that the two properties are
    // reported as distinct rows rather than conflated into one.
    const results = within(await waitFor(() => screen.getByRole('table')));
    expect(results.getByText(/Relative humidity/)).toBeInTheDocument();
    expect(results.getByText(/Degree of saturation/)).toBeInTheDocument();
    expect(results.getByText('50.00')).toBeInTheDocument();
    expect(results.getByText('49.25')).toBeInTheDocument();
  });

  it('switches units on the segmented control and relabels the readout', async () => {
    const user = userEvent.setup();
    render(<App />);
    const units = within(screen.getByRole('group', { name: 'Unit system' }));
    const panel = within(screen.getByRole('complementary', { name: 'Properties' }));
    await user.click(panel.getByRole('button', { name: 'Add state point' }));

    expect(units.getByRole('button', { name: 'SI' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const table = await waitFor(() => screen.getByRole('table'));
    const results = () => within(table);
    expect(results().getAllByText('°C').length).toBeGreaterThan(0);

    await user.click(units.getByRole('button', { name: 'IP' }));
    expect(units.getByRole('button', { name: 'IP' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The unit column is the visible half of the unit system; if it does not
    // follow the toggle the reading is mislabelled rather than merely stale.
    expect(results().getAllByText('°F').length).toBeGreaterThan(0);
    expect(results().queryByText('°C')).not.toBeInTheDocument();
  });

  it('names the point a process would start from, rather than guessing one', async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = within(screen.getByRole('complementary', { name: 'Properties' }));
    // Before there is a point, adding a process is not offered at all: the old
    // panel enabled it and bound the process to `points[0]`.
    expect(panel.getByLabelText('Add process…')).toBeDisabled();

    await user.click(panel.getByRole('button', { name: 'Add state point' }));
    // And once there is one, the control says which point it will start from.
    expect(panel.getByLabelText('Add process…')).toBeEnabled();
    expect(panel.getByText('Add process from OA…')).toBeInTheDocument();
  });

  it('creates the outlet of a process as a point you can select', async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = within(screen.getByRole('complementary', { name: 'Properties' }));
    await user.click(panel.getByRole('button', { name: 'Add state point' }));
    await user.selectOptions(panel.getByLabelText('Add process…'), 'sensible');

    // The endpoint exists and is named, which is what makes the next process
    // able to start from it. The outline row is the selectable one; the process
    // editor names the same pair in prose beside its fields.
    expect(panel.getByRole('button', { name: /OA → RA/ })).toBeInTheDocument();
    expect(panel.getAllByText('OA → RA')).toHaveLength(2);
    expect(usePsychStore.getState().points).toHaveLength(2);

    await user.click(panel.getByRole('button', { name: 'Select outlet' }));
    // Selecting it shows where it came from rather than input fields that would
    // silently do nothing.
    expect(panel.getByText(/Placed by/)).toBeInTheDocument();
    expect(panel.queryByLabelText('Dry-bulb temperature')).not.toBeInTheDocument();
  });

  it('lists the document, so the chain is visible without reading the chart', async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = within(screen.getByRole('complementary', { name: 'Properties' }));
    await user.click(panel.getByRole('button', { name: 'Add state point' }));
    await user.selectOptions(panel.getByLabelText('Add process…'), 'sensible');

    // Three rows: the point that was typed, the point the process placed, and
    // the process joining them. A chart shows positions and cannot show that
    // the second point is the outlet of the first.
    const outline = within(panel.getByRole('list'));
    expect(outline.getAllByRole('listitem')).toHaveLength(3);
    expect(outline.getByText('derived')).toBeInTheDocument();

    // And each row is a way in: selecting the process from here is the only
    // route to it that does not involve finding its line on the chart.
    await user.click(panel.getByRole('button', { name: /OA → RA/ }));
    expect(panel.getByRole('button', { name: /OA → RA/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('offers the bypass factor on a process that can run wet', async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = within(screen.getByRole('complementary', { name: 'Properties' }));
    await user.click(panel.getByRole('button', { name: 'Add state point' }));
    await user.selectOptions(panel.getByLabelText('Add process…'), 'sensible');
    // The field that decides what a coil does once the target crosses the
    // entering dew point. Its absence is what made the old panel report an
    // error there instead of a coil.
    expect(panel.getByLabelText(/Bypass factor/)).toBeInTheDocument();
  });

  it('toggles the theme on the document root, where the palette is keyed', async () => {
    const user = userEvent.setup();
    render(<App />);
    const before = document.documentElement.dataset.theme;
    await user.click(
      screen.getByRole('button', { name: /Switch to (light|dark) theme/ }),
    );
    expect(document.documentElement.dataset.theme).not.toBe(before);
  });
});

// Imported after the mock so the components pick up the stubbed module.
const { App } = await import('./App');
const { usePsychStore } = await import('./store/usePsychStore');
const { useProjectStore } = await import('./store/useProjectStore');
const { useProcessStore } = await import('./store/useProcessStore');
