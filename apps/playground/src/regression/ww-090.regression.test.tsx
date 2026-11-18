/**
 * WW-090 — Custom effort creation silently drops authored body prose —
 * /effort/:slug?mode=create persists frontmatter only.
 *
 * Expected behavior: body prose authored in create mode persists in the
 * stored note (`effort/<slug>`) when Create Effort is clicked.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { EffortDetailPage } from '../../app/pages/EffortDetailPage';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';

let host: PlaygroundRenderResult | null = null;

afterEach(async () => {
  if (host) {
    await host.cleanup();
    host = null;
  }
});

describe('WW-090 — custom effort creation preserves body prose', () => {
  it('persists authored body prose into the stored note on Create Effort', async () => {
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

    await waitFor(async () => {
      const saved = await host!.storageService.getNote(`effort/${slug}`);
      expect(saved).toBeDefined();
      expect(saved!.rawContent).toContain(prose);
    });
  });
});
