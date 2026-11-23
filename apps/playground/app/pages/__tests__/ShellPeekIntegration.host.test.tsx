import React, { useCallback, useEffect, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  getActiveEditorBridge,
  getActivePeekBridge,
  registerActivePeekBridge,
} from '@/agent/surfaceBridges';
import { Navbar } from '@/components/organisms/layout/Navbar';
import { SidebarLayout } from '@/templates/SidebarLayout';
import { StickyPageHeader } from '@/panels/page-shells';
import { TEST_IDS } from '@/lib/testIds';
import { renderWithPlaygroundHost, type PlaygroundRenderResult } from '@/testing/host';
import { EntityPeekDrawer } from '../../components/organisms/EntityPeekDrawer';
import { PlaygroundAgentProvider } from '../../agent/PlaygroundAgentProvider';
import { useNav } from '../../nav/NavContext';
import { NavSidebar } from '../../nav/NavSidebar';
import { NavbarActions } from '../../nav/ResponsiveActions';
import { NoteByIdPage } from '../NoteByIdPage';
import { PageActions } from '../shared/PageActions';
import { NoteContextNav } from '../shared/noteContextLinks';

const zeroRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};
Object.defineProperty(window.Range.prototype, 'getClientRects', {
  configurable: true,
  value: () => [],
});
Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => zeroRect,
});

const originalMatchMedia = window.matchMedia;

function mockViewport(opts: { is2xl?: boolean; isMobile?: boolean }) {
  window.matchMedia = ((query: string) => ({
    matches:
      (Boolean(opts.is2xl) && query.includes('1520px')) ||
      (Boolean(opts.isMobile) && query.includes('1023px')),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

/**
 * Mirrors AppContent's SidebarLayout + EntityPeekDrawer (`layout="slot"`) +
 * ActivePeekBridge wiring so host integration tests exercise the exact
 * cross-slice shell seams.
 */
function IntegratedShellHost({ children }: { children: React.ReactNode }) {
  const { peekTarget, openPeek, closePeek } = useNav();
  const peekTargetRef = useRef(peekTarget ?? null);
  peekTargetRef.current = peekTarget ?? null;

  const handleClosePeek = useCallback(() => {
    closePeek?.();
  }, [closePeek]);

  useEffect(() => {
    if (!openPeek || !closePeek) return;
    return registerActivePeekBridge({
      getTarget: () => peekTargetRef.current,
      openPeek: (target) => {
        peekTargetRef.current = target;
        openPeek(target);
      },
      closePeek: () => {
        peekTargetRef.current = null;
        closePeek();
      },
    });
  }, [openPeek, closePeek]);

  return (
    <SidebarLayout
      navbar={
        <Navbar>
          <span>Shell</span>
          <div className="ml-auto flex items-center gap-1">
            <NavbarActions />
          </div>
        </Navbar>
      }
      sidebar={<NavSidebar />}
      peekSlot={
        <EntityPeekDrawer
          target={peekTarget ?? null}
          onClose={handleClosePeek}
          layout="slot"
        />
      }
    >
      {children}
    </SidebarLayout>
  );
}

interface CapturedWebMcpTool {
  name: string;
  execute: (args: Record<string, unknown>) => Promise<{
    isError?: boolean;
    structuredContent?: unknown;
  }>;
}

function unwrapStructured<T>(result: { isError?: boolean; structuredContent?: unknown }): T {
  expect(result.isError).not.toBe(true);
  return (result.structuredContent ?? result) as T;
}

describe('Wave 2 Cross-Slice Integration (Shell + EntityPeek + Inspector + WebMCP)', () => {
  let host: PlaygroundRenderResult | undefined;

  afterEach(async () => {
    cleanup();
    const docAny = document as unknown as Record<string, unknown>;
    const navAny = navigator as unknown as Record<string, unknown>;
    delete docAny.modelContext;
    delete navAny.modelContext;
    delete navAny.modelContextTesting;
    window.matchMedia = originalMatchMedia;
    await host?.cleanup();
    host = undefined;
  });

  it('opens EntityPeekDrawer inside SidebarLayout.peekSlot from L3 Connections & NoteEditor and enforces Esc + WhiteboardInspectorDrawer mutual exclusion', async () => {
    mockViewport({ is2xl: true, isMobile: false });
    host = await renderWithPlaygroundHost(
      <IntegratedShellHost>
        <NoteByIdPage noteId="note-squat-integration" theme="vs" />
      </IntegratedShellHost>,
      {
        route: '/note/note-squat-integration',
        world: {
          propertyNotes: [
            {
              kind: 'effort',
              slug: 'back-squat',
              label: 'Back Squat',
              aliases: ['bs'],
              baseAttributes: {
                met: 7.5,
                discipline: 'strength',
                intensityTier: 'high',
              },
            },
          ],
          notes: [
            {
              id: 'note-squat-integration',
              title: 'Heavy Lower Session',
              type: 'note',
              rawContent: '# Heavy Lower Session\n\n```time\n5x5 Back Squat @100kg\n```\n',
            },
          ],
        },
      },
    );

    // 1. L3 inline rail renders Connections with Back Squat (and L2 stays steady)
    const l3Rail = await screen.findByTestId(TEST_IDS.L3_INLINE_RAIL);
    const connections = await within(l3Rail).findByTestId(TEST_IDS.L3_CONNECTIONS);
    const effortBtn = await within(connections).findByRole('button', { name: 'Back Squat' });

    // 2. Clicking the L3 connection opens EntityPeekDrawer inside SidebarLayout.peekSlot
    fireEvent.click(effortBtn);

    const slot = await screen.findByTestId(TEST_IDS.PEEK_DRAWER_SLOT);
    const peekDrawer = within(slot).getByTestId(TEST_IDS.ENTITY_PEEK_DRAWER);
    expect(screen.queryByTestId(TEST_IDS.ENTITY_PEEK_BACKDROP)).toBeNull();
    expect(screen.getByTestId(TEST_IDS.INSPECTOR_DRAWER_RAIL_SPACER)).toBeTruthy();
    expect(screen.queryByTestId(TEST_IDS.L3_INLINE_RAIL)).toBeNull();

    await waitFor(() => {
      expect(peekDrawer.textContent).toContain('Back Squat');
      expect(peekDrawer.textContent).toContain('back-squat');
    });

    // 3. Pressing Escape dismisses EntityPeekDrawer and restores L3 inline rail
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId(TEST_IDS.ENTITY_PEEK_DRAWER)).toBeNull();
      expect(screen.getByTestId(TEST_IDS.L3_INLINE_RAIL)).toBeTruthy();
    });

    // 4. Triggering peek via NoteEditor opens EntityPeekDrawer in peekSlot,
    //    and opening WhiteboardInspectorDrawer closes EntityPeekDrawer (mutual exclusion)
    await waitFor(() => {
      expect(getActiveEditorBridge()).not.toBeNull();
    });
    const editorBridge = getActiveEditorBridge()!;

    act(() => {
      editorBridge.peekEntity?.({ kind: 'effort', slug: 'back-squat', label: 'Back Squat' });
    });
    await screen.findByTestId(TEST_IDS.ENTITY_PEEK_DRAWER);

    act(() => {
      editorBridge.setInspectorDrawer?.(true);
    });
    await waitFor(() => {
      expect(screen.queryByTestId(TEST_IDS.ENTITY_PEEK_DRAWER)).toBeNull();
      expect(editorBridge.getInspectorState?.().drawerOpen).toBe(true);
      expect(screen.getByTestId(TEST_IDS.INSPECTOR_DRAWER_RAIL_SPACER)).toBeTruthy();
    });

    // 5. Re-opening EntityPeekDrawer closes WhiteboardInspectorDrawer cleanly
    act(() => {
      editorBridge.peekEntity?.({ kind: 'effort', slug: 'back-squat', label: 'Back Squat' });
    });
    await waitFor(() => {
      expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_DRAWER)).toBeTruthy();
      expect(editorBridge.getInspectorState?.().drawerOpen).toBe(false);
    });
  });

  it('registers ui_peek_entity once via ActivePeekBridge and opens/inspects/closes EntityPeekDrawer', async () => {
    mockViewport({ is2xl: true, isMobile: false });
    const registered = new Map<string, CapturedWebMcpTool[]>();
    const fakeMc = {
      __isBrowserMcpServer: true,
      registerTool: async (tool: CapturedWebMcpTool) => {
        const list = registered.get(tool.name) ?? [];
        list.push(tool);
        registered.set(tool.name, list);
        return {
          unregister: () => {
            const cur = registered.get(tool.name);
            if (!cur) return;
            const next = cur.filter((entry) => entry !== tool);
            if (next.length === 0) registered.delete(tool.name);
            else registered.set(tool.name, next);
          },
        };
      },
      getTools: async () => [...registered.values()].flat(),
      executeTool: async () => '{}',
    };
    (document as unknown as Record<string, unknown>).modelContext = fakeMc;

    host = await renderWithPlaygroundHost(
      <>
        <PlaygroundAgentProvider />
        <IntegratedShellHost>
          <NoteByIdPage noteId="note-webmcp-peek" theme="vs" />
        </IntegratedShellHost>
      </>,
      {
        route: '/note/note-webmcp-peek',
        world: {
          propertyNotes: [
            {
              kind: 'equipment',
              slug: 'kettlebell',
              label: 'Kettlebell',
              aliases: ['kb'],
            },
          ],
          notes: [
            {
              id: 'note-webmcp-peek',
              title: 'KB Complex',
              type: 'note',
              rawContent: '# KB Complex\n\n```time\n20 Kettlebell Swing @24kg\n```\n',
            },
          ],
        },
      },
    );

    await waitFor(() => {
      expect(getActivePeekBridge()).not.toBeNull();
      expect(getActiveEditorBridge()).not.toBeNull();
      expect(registered.get('ui_peek_entity')).toBeDefined();
    });

    // Registered exactly once even when BOTH ActivePeekBridge and NoteEditor are mounted
    const peekTools = registered.get('ui_peek_entity')!;
    expect(peekTools).toHaveLength(1);
    const uiPeekTool = peekTools[0]!;

    // 1. status while closed
    const initialStatus = unwrapStructured<{
      ok: boolean;
      open: boolean;
      target: unknown;
    }>(await act(async () => uiPeekTool.execute({ action: 'status' })));
    expect(initialStatus).toEqual({ ok: true, open: false, target: null });

    // 2. open via ui_peek_entity renders EntityPeekDrawer in peekSlot
    const opened = unwrapStructured<{
      ok: boolean;
      open: boolean;
      target: { kind: string; slug: string } | null;
    }>(await act(async () =>
      uiPeekTool.execute({ action: 'open', kind: 'equipment', slug: 'kettlebell' }),
    ));
    expect(opened.ok).toBe(true);
    expect(opened.open).toBe(true);
    expect(opened.target).toMatchObject({ kind: 'equipment', slug: 'kettlebell' });

    const drawer = await screen.findByTestId(TEST_IDS.ENTITY_PEEK_DRAWER);
    await waitFor(() => {
      expect(drawer.textContent).toContain('Kettlebell');
    });

    // 3. close via ui_peek_entity dismisses EntityPeekDrawer
    const closed = unwrapStructured<{
      ok: boolean;
      open: boolean;
      target: unknown;
    }>(await act(async () => uiPeekTool.execute({ action: 'close' })));
    expect(closed).toEqual({ ok: true, open: false, target: null });
    await waitFor(() => {
      expect(screen.queryByTestId(TEST_IDS.ENTITY_PEEK_DRAWER)).toBeNull();
    });
    const finalStatus = unwrapStructured<{
      ok: boolean;
      open: boolean;
      target: unknown;
    }>(await act(async () => uiPeekTool.execute({ action: 'status' })));
    expect(finalStatus).toEqual({ ok: true, open: false, target: null });
  });

  it('uses ResponsiveActionsDock on <lg mobile with no top-right L3 trigger, L3DrawerTrigger on lg–2xl, and inline rail on >=2xl', async () => {
    function DetailRouteFixture() {
      const { setL3Actions } = useNav();
      useEffect(() => {
        setL3Actions?.([
          { id: 'run', label: 'Run Workout', group: 'primary', onRun: () => {} },
        ]);
        return () => setL3Actions?.([]);
      }, [setL3Actions]);
      return (
        <>
          <NoteContextNav
            data={{
              efforts: [{ id: 'back-squat', title: 'Back Squat', to: '/effort/back-squat' }],
              related: [],
              backlinks: [],
            }}
            peekMode
          />
          <StickyPageHeader title="Benchmark Note" actions={<PageActions />} />
        </>
      );
    }

    // 1. <lg mobile: NO top-right L3DrawerTrigger or "Open page options"; thumb-zone dock owns L3 sheet
    mockViewport({ is2xl: false, isMobile: true });
    host = await renderWithPlaygroundHost(
      <IntegratedShellHost>
        <DetailRouteFixture />
      </IntegratedShellHost>,
      { route: '/note/mobile-check' },
    );

    expect(screen.queryByTestId('l3-drawer-trigger')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open page options' })).toBeNull();
    expect(screen.queryByTestId(TEST_IDS.L3_INLINE_RAIL)).toBeNull();

    const dock = screen.getByTestId(TEST_IDS.ACTIONS_DOCK);
    const overflowBtn = within(dock).getByTestId(TEST_IDS.ACTIONS_OVERFLOW);
    fireEvent.click(overflowBtn);

    const mobileL3Sheet = await screen.findByTestId(TEST_IDS.ACTIONS_SHEET_L3);
    expect(within(mobileL3Sheet).getByTestId(TEST_IDS.L3_CONNECTIONS)).toBeTruthy();
    expect(within(mobileL3Sheet).getByTestId(TEST_IDS.L3_ACTIONS)).toBeTruthy();

    await host.cleanup();
    host = undefined;

    // 2. lg–2xl tablet/medium desktop: L3DrawerTrigger toggles RightL3Drawer; no inline rail or mobile dock
    mockViewport({ is2xl: false, isMobile: false });
    host = await renderWithPlaygroundHost(
      <IntegratedShellHost>
        <DetailRouteFixture />
      </IntegratedShellHost>,
      { route: '/note/tablet-check' },
    );

    expect(screen.queryByTestId(TEST_IDS.ACTIONS_DOCK)).toBeNull();
    expect(screen.queryByTestId(TEST_IDS.L3_INLINE_RAIL)).toBeNull();

    const tabletTrigger = screen.getByTestId('l3-drawer-trigger');
    fireEvent.click(tabletTrigger);
    expect(await screen.findByTestId(TEST_IDS.L3_RIGHT_DRAWER)).toBeTruthy();

    await host.cleanup();
    host = undefined;

    // 3. >=2xl desktop: inline L3 rail docks cleanly; L3DrawerTrigger hidden
    mockViewport({ is2xl: true, isMobile: false });
    host = await renderWithPlaygroundHost(
      <IntegratedShellHost>
        <DetailRouteFixture />
      </IntegratedShellHost>,
      { route: '/note/desktop-check' },
    );

    expect(screen.queryByTestId('l3-drawer-trigger')).toBeNull();
    expect(screen.getByTestId(TEST_IDS.L3_INLINE_RAIL)).toBeTruthy();
  });
});
