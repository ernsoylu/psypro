/**
 * The pages, and the two claims they make that a reader would act on.
 *
 * The Process Design page prints a coil datasheet. If the three bypass-factor
 * forms it shows disagree, or the condensate credit is missing, a reader
 * selecting equipment from it selects the wrong equipment — so those are the
 * two things asserted here, through the rendered page rather than the engine.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { App } from '../App';
import { initEngine } from '../psychro';
import { useProjectStore } from '../store/useProjectStore';
import { usePsychStore } from '../store/usePsychStore';
import { useProcessStore } from '../store/useProcessStore';
import { InputState } from '../psychro';

beforeAll(async () => {
  // The real engine, not a mock. The generated loader fetches the module over
  // HTTP and there is no server here, so the bytes come off disk — which is
  // what makes the assertions below about the coil rather than about a stub.
  const wasm = readFileSync(join(process.cwd(), 'src/wasm/psychro_bg.wasm'));
  await initEngine(wasm);
});

beforeEach(() => {
  usePsychStore.setState({ points: [], selectedId: null });
  useProcessStore.setState({ processes: [], selectedId: null });
  useProjectStore.setState({ isSi: true, altitude: '0', realGas: true, name: '' });
});

describe('page tabs', () => {
  it('shows the pages that are not built yet as disabled rather than hidden', () => {
    render(<App />);
    // Hiding them would teach that the tool cannot do it; disabling them says
    // this build does not yet, which is the true statement.
    expect(screen.getByRole('tab', { name: 'Report' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Chart' })).toBeEnabled();
    expect(screen.getByRole('tab', { name: 'Weather data' })).toBeEnabled();
  });
});

describe('the process design page', () => {
  it('agrees with itself on all three bypass-factor forms', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Process design' }));

    const panel = within(
      await waitFor(() =>
        screen.getByRole('complementary', { name: 'Component inspector' }),
      ),
    );
    const read = (label: string) =>
      Number(
        panel.getByRole('row', { name: new RegExp(label) }).querySelectorAll('td')[0]
          ?.textContent,
      );

    const onW = read('Bypass factor — on W');
    const onH = read('Bypass factor — on h');
    const onT = read('Bypass factor — on t');

    expect(onW).toBeGreaterThan(0);
    // The W and h forms are the same interpolation read two ways.
    expect(Math.abs(onH - onW)).toBeLessThan(1e-3);
    // The temperature form differs only by the curvature of enthalpy in t.
    expect(Math.abs(onT - onW)).toBeLessThan(5e-3);
  });

  it('reports the condensate credit rather than dropping it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Process design' }));

    const panel = within(
      await waitFor(() =>
        screen.getByRole('complementary', { name: 'Component inspector' }),
      ),
    );
    const read = (label: string) =>
      Number(
        panel.getByRole('row', { name: new RegExp(label) }).querySelectorAll('td')[0]
          ?.textContent,
      );

    const airSide = read('Air-side enthalpy drop');
    const total = read('Total load, condensate credited');
    expect(airSide).toBeGreaterThan(0);
    // Small, and present. Under one percent is exactly why it gets dropped.
    expect(total).toBeLessThan(airSide);
    expect((airSide - total) / airSide).toBeLessThan(0.02);
  });

  it('shows the coil load above the room load, because ventilation costs', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Process design' }));

    const strip = await waitFor(() => screen.getByLabelText('Cycle results'));
    const load = Number(
      within(strip)
        .getByText('Coil total load')
        .parentElement?.querySelector('dd')
        ?.textContent?.replace(/[^\d.]/g, ''),
    );
    // The room asks for 25 kW; the coil also has to cool the outdoor air down
    // from the design condition. A cycle that did not show that would
    // understate the plant.
    expect(load).toBeGreaterThan(25);
  });

  it('offers the circuit editor, and a palette that needs air to start from', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Process design' }));

    // The page used to draw seven fixed blocks in a row and grey out the ones
    // the macro did not run. It is an editor now: the blocks are whatever the
    // plant is.
    expect(await waitFor(() => screen.getByLabelText('Circuit'))).toBeInTheDocument();

    // A circuit has to start with air coming from somewhere, so the palette is
    // inert until the document has a state point — the same rule the process
    // panel follows, and for the same reason.
    const inspector = within(
      screen.getByRole('complementary', { name: 'Component inspector' }),
    );
    expect(
      inspector.getByRole('button', { name: 'Cooling coil (ADP + bypass)' }),
    ).toBeDisabled();
  });

  it('adds a block to the circuit, which is a process on the chart', async () => {
    const user = userEvent.setup();
    usePsychStore.getState().addPoint({
      label: 'OA',
      dryBulb: 35,
      mode: InputState.DbtRh,
      secondValue: 40,
    });
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Process design' }));

    const inspector = within(
      screen.getByRole('complementary', { name: 'Component inspector' }),
    );
    await user.click(
      inspector.getByRole('button', { name: 'Cooling coil (ADP + bypass)' }),
    );

    // One block placed, one process in the document, one outlet point to draw
    // on the chart. The schematic has no graph of its own to keep in step.
    expect(useProcessStore.getState().processes).toHaveLength(1);
    expect(useProcessStore.getState().processes[0]!.kind).toBe('cooling');
    expect(usePsychStore.getState().points).toHaveLength(2);
  });
});
