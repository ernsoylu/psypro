/**
 * The styling matrix dialog, exercised the way a reader drives it.
 *
 * The dialog edits a matrix it is handed and owns no state of its own, so the
 * tests watch the callbacks: each gesture must say exactly what it changed, and
 * for which family. The theme has not resolved under jsdom, which also lets the
 * tests pin the modal's behaviour while the palette is unavailable.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { CurveFamilyId } from '../psychro';
import { DEFAULT_STYLES } from '../store/useStyleStore';
import { StyleModal, type StyleModalProps } from './StyleModal';

function renderModal(overrides: Partial<StyleModalProps> = {}) {
  const props: StyleModalProps = {
    styles: DEFAULT_STYLES,
    onSetStyle: vi.fn(),
    onResetFamily: vi.fn(),
    onResetAll: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<StyleModal {...props} />);
  return { props, ...view };
}

describe('line styles modal', () => {
  it('names the dialog and every family the chart draws', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Line styles' })).toBeInTheDocument();
    for (const label of [
      'Dry-bulb temperature',
      'Humidity ratio',
      'Relative humidity',
      'Wet-bulb temperature',
      'Enthalpy',
      'Specific volume',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('states the two boundary rules in the footer', () => {
    renderModal();
    expect(screen.getByText(/boundary of the physical region/)).toBeInTheDocument();
    expect(screen.getByText(/not saved in the project file/)).toBeInTheDocument();
  });

  it('disables the swatches while the theme has not resolved', () => {
    const { container } = renderModal();
    const swatches = container.querySelectorAll('input[type="color"]');
    expect(swatches).toHaveLength(6);
    // An input with no palette behind it would edit nothing, so it refuses.
    for (const swatch of swatches) expect(swatch).toBeDisabled();
  });

  it('restyles one family without a word about the others', () => {
    const { props } = renderModal();
    const row = screen.getByRole('row', { name: /Wet-bulb temperature/ });
    fireEvent.change(within(row).getByRole('combobox'), {
      target: { value: 'dotted' },
    });
    expect(props.onSetStyle).toHaveBeenCalledWith(CurveFamilyId.WetBulb, {
      lineStyle: 'dotted',
    });
    expect(props.onSetStyle).toHaveBeenCalledTimes(1);
  });

  it('offers the width range the drawing pipeline accepts', () => {
    const { props } = renderModal();
    const row = screen.getByRole('row', { name: /Enthalpy/ });
    const width = within(row).getByRole('spinbutton');
    expect(width).toHaveAttribute('min', '0.25');
    expect(width).toHaveAttribute('max', '8');
    fireEvent.change(width, { target: { value: '2.5' } });
    expect(props.onSetStyle).toHaveBeenCalledWith(CurveFamilyId.Enthalpy, {
      width: 2.5,
    });
  });

  it('restores one family from its own row', () => {
    const { props } = renderModal();
    const row = screen.getByRole('row', { name: /Relative humidity/ });
    fireEvent.click(
      within(row).getByRole('button', {
        name: 'Reset this family to the theme default',
      }),
    );
    expect(props.onResetFamily).toHaveBeenCalledWith(CurveFamilyId.RelativeHumidity);
  });

  it('restores every family, and closes, from the footer', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Reset all to theme defaults' }));
    expect(props.onResetAll).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const { props } = renderModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked, not when the dialog is clicked', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByRole('dialog'));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the dialog' }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
