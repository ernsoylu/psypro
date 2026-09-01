import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The generated WASM module cannot be instantiated under jsdom, so the binding
// surface is stubbed here. This test covers the component contract; the
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
  return {
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

describe('App', () => {
  it('renders the engine debug panel', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'PsyPro' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('engine 0.1.0')).toBeInTheDocument());
  });

  it('reports relative humidity and degree of saturation as separate properties', async () => {
    render(<App />);
    const table = await waitFor(() => screen.getByRole('table'));
    // Scoped to the results table: "Relative humidity" also appears as a
    // <select> option, and the point of this test is that the two properties are
    // reported as distinct rows rather than conflated into one.
    const results = within(table);
    expect(results.getByText(/Relative humidity/)).toBeInTheDocument();
    expect(results.getByText(/Degree of saturation/)).toBeInTheDocument();
    expect(results.getByText('50.00')).toBeInTheDocument();
    expect(results.getByText('49.25')).toBeInTheDocument();
  });
});

// Imported after the mock so the component picks up the stubbed module.
const { App } = await import('./App');
