import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { TEST_IDS } from '@/lib/testIds';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';
import { EffortDetailPage } from '../EffortDetailPage';

describe('EffortDetailPage — create mode persistence & body prose preservation (WW-090, WW-020)', () => {
  let host: PlaygroundRenderResult | null = null;

  afterEach(async () => {
    cleanup();
    if (host) {
      await host.cleanup();
      host = null;
    }
  });

  it('WW-090: preserves authored body prose end-to-end when creating a custom effort and stamps seedOrigin=user', async () => {
    const slug = 'sled-drive-qa';
    const prose = '10 Sled Drive (empty sled) QA effort';

    host = await renderWithPlaygroundHost(<EffortDetailPage />, {
      route: `/effort/${slug}?mode=create`,
      routePath: '/effort/:slug',
    });

    const createBtn = await screen.findByTestId('effort-create-btn');
    const cmContent = host.rendered.container.querySelector('.cm-content') as HTMLElement | null;
    expect(cmContent).not.toBeNull();

    const view = EditorView.findFromDOM(cmContent!);
    expect(view).not.toBeNull();
    view!.dispatch({
      changes: { from: view!.state.doc.length, insert: `\n${prose}\n` },
    });

    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(host!.getLocation().pathname).toBe(`/effort/${slug}`);
    });

    const saved = await host.storageService.getNote(`effort/${slug}`);
    expect(saved).toBeDefined();
    expect(saved!.seedOrigin).toBe('user');
    expect(saved!.rawContent).toContain(prose);

    const persistedEffort = await host.storageService.getEffort(slug);
    expect(persistedEffort).toBeDefined();
    expect(persistedEffort?.registrySource).toBe('user');

    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.EFFORT_DETAIL_NOTEBOOK_EDITOR).textContent).toContain(prose);
    });
  });

  it('opens create mode directly when navigating to /effort/new without ?mode=create', async () => {
    host = await renderWithPlaygroundHost(<EffortDetailPage />, {
      route: '/effort/new',
      routePath: '/effort/:slug',
    });

    expect(await screen.findByTestId('effort-create-btn')).toBeDefined();
    expect(screen.getByTestId('effort-create-editor')).toBeDefined();
    expect(screen.queryByTestId(TEST_IDS.EFFORT_NOT_FOUND)).toBeNull();
  });
});
