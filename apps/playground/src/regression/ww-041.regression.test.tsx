/**
 * WW-041 — Uploading a manifest-less/empty .zip on /load silently bounces
 * to Home with zero import feedback.
 *
 * Expected behavior: uploading an empty .zip on /load stays on /load and
 * surfaces the bundle-import-error alert.
 */
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { LoadZipPage } from '../../app/pages/LoadZipPage';
import { TEST_IDS } from '@/lib/testIds';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';

let host: PlaygroundRenderResult | null = null;

afterEach(async () => {
  if (host) {
    await host.cleanup();
    host = null;
  }
});

describe('WW-041 — empty .zip upload on /load', () => {
  it('stays on /load and surfaces bundle-import-error for an empty .zip', async () => {
    const emptyBytes = await new JSZip().generateAsync({ type: 'arraybuffer' });
    const emptyFile = new File([emptyBytes], 'empty-bundle.zip', { type: 'application/zip' });

    host = await renderWithPlaygroundHost(<LoadZipPage />, {
      route: '/load',
      routePath: '/load',
    });

    const input = screen.getByTestId(TEST_IDS.BUNDLE_FILE_INPUT) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [emptyFile] } });

    const errorAlert = await screen.findByTestId(TEST_IDS.BUNDLE_IMPORT_ERROR);
    expect(errorAlert.getAttribute('role')).toBe('alert');
    expect(host.getLocation().pathname).toBe('/load');
    expect(screen.getByTestId(TEST_IDS.LOAD_ZIP_INTAKE)).toBeTruthy();
  });
});
