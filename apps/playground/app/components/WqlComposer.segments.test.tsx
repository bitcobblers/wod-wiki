import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WqlComposer } from '@bitcobblers/wod-wiki-ui';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WqlComposer segment editor keyboard and mobile traversal (Tier 2a)', () => {
  it('activates field picker on Tab and traverses segments forward and backward with Tab / Shift+Tab', async () => {
    render(<WqlComposer initialQuery=":note{tags:benchmark} last 8w" compact />);

    const editor = screen.getByLabelText('WQL');
    act(() => {
      editor.focus();
      fireEvent.keyDown(editor, { key: 'Home', code: 'Home' });
      fireEvent.keyDown(editor, { key: 'Tab', code: 'Tab' });
    });

    await waitFor(() => {
      expect(screen.getByTestId('wql-field-picker')).toBeTruthy();
    });
    expect(document.querySelector('.wql-active-segment')).toBeTruthy();

    const picker = screen.getByTestId('wql-picker-search');
    const initialLabel = picker.getAttribute('aria-label');

    fireEvent.keyDown(picker, { key: 'Tab', code: 'Tab', shiftKey: true });
    await waitFor(() => {
      expect(screen.getByTestId('wql-picker-search').getAttribute('aria-label')).not.toBe(initialLabel);
    });

    fireEvent.keyDown(screen.getByTestId('wql-picker-search'), {
      key: 'Tab',
      code: 'Tab',
    });
    await waitFor(() => {
      expect(screen.getByTestId('wql-picker-search').getAttribute('aria-label')).toBe(initialLabel);
    });
  });

  it('navigates token slots via wql-segment-next and wql-segment-previous buttons in compact mode', async () => {
    render(<WqlComposer initialQuery=":note{tags:benchmark} last 8w" compact />);

    const firstToken = document.querySelector<HTMLElement>(
      '[data-testid^="token-slot-"]:not([data-testid^="token-slot-remove-"]):not([data-testid^="token-slot-value-"])',
    );
    expect(firstToken).toBeTruthy();
    fireEvent.click(firstToken!);

    await waitFor(() => {
      expect(screen.getByTestId('wql-field-picker')).toBeTruthy();
    });

    const initialLabel = screen.getByTestId('wql-picker-search').getAttribute('aria-label');
    fireEvent.click(screen.getByTestId('wql-segment-next'));
    await waitFor(() => {
      expect(screen.getByTestId('wql-picker-search').getAttribute('aria-label')).not.toBe(initialLabel);
    });

    fireEvent.click(screen.getByTestId('wql-segment-previous'));
    await waitFor(() => {
      expect(screen.getByTestId('wql-picker-search').getAttribute('aria-label')).toBe(initialLabel);
    });
  });
});
