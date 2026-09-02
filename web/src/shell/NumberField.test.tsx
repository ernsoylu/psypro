/**
 * The typing behaviour, driven the way a user types.
 *
 * The bug these pin: a field bound straight to a formatted store value ate the
 * second digit of `35` — `3` was committed, the field re-rendered as `"3.00"`,
 * and the `5` landed among the decimals. Every assertion here is a keystroke
 * sequence that used to come out wrong.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { COMMIT_DELAY_MS, NumberField, parseDraft } from './NumberField';
import { UnitField } from './UnitField';

function field(props: Partial<Parameters<typeof NumberField>[0]> = {}) {
  const onCommit = vi.fn();
  render(
    <NumberField
      value={3}
      format={(v) => v.toFixed(2)}
      onCommit={onCommit}
      aria-label="Dry-bulb temperature"
      {...props}
    />,
  );
  return { onCommit, input: screen.getByLabelText('Dry-bulb temperature') };
}

describe('a number field being typed into', () => {
  it('keeps every digit typed, and commits the whole number once', async () => {
    const user = userEvent.setup();
    const { onCommit, input } = field();

    await user.clear(input);
    await user.type(input, '35');

    // The text is what was typed — not "3.00" with a 5 pushed into it.
    expect(input).toHaveValue('35');
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(35), { timeout: 2000 });
    expect(onCommit.mock.calls.map(([v]) => v)).toEqual([35]);
  });

  it('lets a decimal point survive being typed', async () => {
    const user = userEvent.setup();
    const { onCommit, input } = field();

    await user.clear(input);
    await user.type(input, '23.5');

    expect(input).toHaveValue('23.5');
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(23.5), { timeout: 2000 });
  });

  it('does not commit a half-typed negative as zero', async () => {
    const user = userEvent.setup();
    const { onCommit, input } = field();

    await user.clear(input);
    await user.type(input, '-');
    // "" is not 0 and "-" is not a number: neither may reach the chart, which
    // is what pinned a marker at 0 °C on the way to -5.
    expect(onCommit).not.toHaveBeenCalled();

    await user.type(input, '5');
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(-5), { timeout: 2000 });
    expect(onCommit.mock.calls.map(([v]) => v)).toEqual([-5]);
  });

  it('commits at once on blur rather than waiting out the delay', async () => {
    const user = userEvent.setup();
    const { onCommit, input } = field();

    await user.clear(input);
    await user.type(input, '18');
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith(18);
  });

  it('shows the stored value again once focus leaves', async () => {
    const user = userEvent.setup();
    const { input } = field();

    await user.clear(input);
    await user.type(input, 'not a number');
    await user.tab();

    // An abandoned draft shows what is actually stored, not what was typed.
    expect(input).toHaveValue('3.00');
  });

  it('waits before committing, so the chart is not redrawn per keystroke', async () => {
    vi.useFakeTimers();
    try {
      const { onCommit, input } = field();

      // Typed straight in rather than through userEvent, which schedules its
      // own timers and cannot be driven by a clock this test owns.
      fireEvent.change(input, { target: { value: '3' } });
      fireEvent.change(input, { target: { value: '35' } });
      await vi.advanceTimersByTimeAsync(COMMIT_DELAY_MS - 1);
      expect(onCommit).not.toHaveBeenCalled();

      // One commit, of the whole number — not one per keystroke, and not a 3
      // on the way to 35.
      await vi.advanceTimersByTimeAsync(1);
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(35);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('what counts as a number yet', () => {
  it('refuses the half-typed and accepts the rest', () => {
    for (const text of ['', ' ', '-', '+', '.', '-.', 'abc', '1e']) {
      expect(parseDraft(text)).toBeNull();
    }
    expect(parseDraft('35')).toBe(35);
    expect(parseDraft('23.')).toBe(23);
    expect(parseDraft('-5.5')).toBe(-5.5);
    expect(parseDraft(' 0.009 ')).toBe(0.009);
  });
});

describe('a field with a unit dropdown', () => {
  it('converts what was typed into the document unit', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <UnitField
        label="Dry-bulb temperature"
        dimension="temperature"
        isSi={true}
        value={24}
        onCommit={onCommit}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Unit for Dry-bulb temperature'), 'F');
    // The stored 24 °C is the same state written another way.
    expect(screen.getByLabelText('Dry-bulb temperature')).toHaveValue('75.20');

    const input = screen.getByLabelText('Dry-bulb temperature');
    await user.clear(input);
    await user.type(input, '95');
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith(35);
  });

  it('offers a volumetric flow only when the air state is in hand', () => {
    const { unmount } = render(
      <UnitField
        label="Dry-air mass flow"
        dimension="flow"
        isSi={true}
        value={1}
        onCommit={vi.fn()}
      />,
    );
    // No specific volume, no V̇ / v_da, so no m³/h on offer.
    expect(screen.queryByRole('option', { name: 'm³/h' })).not.toBeInTheDocument();
    unmount();

    render(
      <UnitField
        label="Dry-air mass flow"
        dimension="flow"
        isSi={true}
        value={1}
        vDaSi={0.85}
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByRole('option', { name: 'm³/h' })).toBeInTheDocument();
  });

  it('converts a volumetric entry through the specific volume', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <UnitField
        label="Dry-air mass flow"
        dimension="flow"
        isSi={true}
        value={1}
        vDaSi={0.85}
        onCommit={onCommit}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText('Unit for Dry-air mass flow'),
      'm3/h',
    );
    const input = screen.getByLabelText('Dry-air mass flow');
    await user.clear(input);
    await user.type(input, '3600');
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith(expect.closeTo(1 / 0.85, 10));
  });
});
