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
  };
});

// The stores are module-level singletons, so a point added by one test would
// still be there for the next one — and "no point selected" is a state worth
// testing rather than an accident of ordering.
beforeEach(() => {
  usePsychStore.setState({ points: [], selectedId: null });
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
