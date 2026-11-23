import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CastButtonRpc } from '../CastButtonRpc';
import type { ICastBackendState } from '@/hooks/useCastSignaling';

const toastMock = vi.fn();
let mockBackendState: ICastBackendState = 'unavailable';
const startSessionMock = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock('@/hooks/useCastSignaling', () => ({
  sharedCastSessionManager: {
    isConnected: false,
    getActiveHandle: () => null,
    disconnect: vi.fn(),
    connect: vi.fn(),
    dispose: vi.fn(),
  },
  getCastBackend: () => ({
    get state() {
      return mockBackendState;
    },
    onStateChanged: () => () => {},
    startSession: startSessionMock,
    endSession: vi.fn(),
  }),
  setActiveCastTransport: vi.fn(),
}));

afterEach(() => {
  cleanup();
  toastMock.mockClear();
  startSessionMock.mockReset();
  mockBackendState = 'unavailable';
});

describe('WW-066 — CastButtonRpc user-visible feedback', () => {
  it('keeps unavailable cast control clickable (aria-disabled) and shows toast feedback', () => {
    mockBackendState = 'unavailable';
    render(<CastButtonRpc />);

    const btn = screen.getByRole('button', { name: 'Cast to TV (unavailable)' });
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(btn);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Cast unavailable' }),
    );
  });

  it('shows destructive toast when startSession rejects with a non-cancel error', async () => {
    mockBackendState = 'ready';
    startSessionMock.mockRejectedValueOnce(new Error('session_error: No receiver responded'));
    render(<CastButtonRpc />);

    const btn = screen.getByRole('button', { name: 'Cast to TV' });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Cast failed',
          variant: 'destructive',
          description: expect.stringContaining('session_error'),
        }),
      );
    });
  });
});
