/**
 * LoadZipPage — WW-031: `/load` without a zip renders a real Portable Bundle
 * Import surface (main[data-agent-status=ready]) instead of bouncing; with
 * `?zip=` the global useZipProcessor owns the flow and the page stays in its
 * progress state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router';
import { LoadZipPage } from './LoadZipPage';
import * as ExportImportService from '@/services/ExportImportService';
import * as toastModule from '@/hooks/use-toast';

// importFromZip runs against the real IndexedDB provider — spy the seam.
let importCalls: Array<{ name: string }> = [];
let importImpl: (file: File) => Promise<{ imported: number; sessionsImported?: number; errors: string[] }> = async () =>
  ({ imported: 2, sessionsImported: 1, errors: [] });

beforeEach(() => {
  importCalls = [];
  importImpl = async () => ({ imported: 2, sessionsImported: 1, errors: [] });
  vi.spyOn(ExportImportService, 'importFromZip').mockImplementation((async (file: File) => {
    importCalls.push({ name: file.name });
    return importImpl(file);
  }) as never);
  vi.spyOn(toastModule, 'toast').mockImplementation((() => {}) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

function renderAt(entry = '/load') {
  return render(
    <MemoryRouter initialEntries={[entry]} initialIndex={0}>
      <NuqsAdapter>
        <LoadZipPage />
      </NuqsAdapter>
    </MemoryRouter>,
  );
}

function bundleFile(name = 'bundle.zip'): File {
  return new File(['PK'], name, { type: 'application/zip' });
}

describe('LoadZipPage portable bundle import (WW-031)', () => {
  it('renders the import intake with a ready agent status and escape hatches', async () => {
    renderAt();

    const main = document.querySelector('main');
    expect(main).not.toBeNull();
    expect(main!.getAttribute('data-agent-status')).toBe('ready');
    expect(main!.getAttribute('aria-busy')).toBe('false');
    expect(screen.getByRole('heading', { name: 'Import Workout Bundle' })).toBeTruthy();
    expect(screen.getByTestId('bundle-file-input')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('imports a picked portable bundle and reports the import summary', async () => {
    renderAt();

    const input = screen.getByTestId('bundle-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [bundleFile('my-bundle.zip')] } });

    await waitFor(() => expect(importCalls).toEqual([{ name: 'my-bundle.zip' }]));
    // The success summary toast fired (then the flow navigates Home).
    await waitFor(() => expect(toastModule.toast).toHaveBeenCalled());
  });

  it('surfaces a clear error alert for an invalid bundle', async () => {
    importImpl = async () => {
      throw new Error('Invalid portable bundle');
    };
    renderAt();

    const input = screen.getByTestId('bundle-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [bundleFile('garbage.zip')] } });

    await waitFor(() => expect(screen.getByTestId('bundle-import-error').textContent).toContain('Invalid portable bundle'));
    // The intake stays mounted for a retry.
    expect(screen.getByTestId('load-zip-intake')).toBeTruthy();
  });

  it('keeps the progress state while a ?zip= bundle is being processed', async () => {
    renderAt('/load?zip=encoded-content');

    // The global useZipProcessor owns the flow — no intake form.
    await waitFor(() => expect(screen.getByText('Loading…')).toBeTruthy());
    expect(document.querySelector('[data-testid="load-zip-intake"]')).toBeNull();
  });
});
