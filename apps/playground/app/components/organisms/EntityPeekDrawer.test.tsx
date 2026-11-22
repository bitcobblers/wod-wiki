import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { EditorView } from '@codemirror/view';
import {
  saveScopedPropertyOverride,
  MetricType,
  ParsedCodeStatement,
  type ICodeStatement,
  type IMetric,
} from '@bitcobblers/wod-wiki-engine';
import type { EditorSection } from '@bitcobblers/wod-wiki-ui/extensions';
import type { EditorState } from '@codemirror/state';
import { NoteEditor, parseEntityPeekUrl } from '@/components/organisms/editor/NoteEditor';
import { MetricInlinePanel } from '@/components/organisms/editor/MetricInlinePanel';
import { getActivePeekBridge } from '@/agent/surfaceBridges';
import { getAppEffortRegistry, getAppEquipmentRegistry, storageService } from '@/hooks/useBrowserServices';
import { notebookService } from '@/services/NotebookService';
import { TEST_IDS } from '@/lib/testIds';
import { renderWithPlaygroundHost, setupPlaygroundTestHost, type PlaygroundHostHandle } from '@/testing/host';
import { exportPlaygroundUiToolsManifest, uiPeekEntitySchema } from '../../agent/uiToolSpecs';
import { journalSchedule } from '../../services/journalSchedule';
import { EntityPeekDrawer, type EntityPeekTarget } from './EntityPeekDrawer';

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

function setDesktopMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('EntityPeekDrawer', () => {
  let host: PlaygroundHostHandle | undefined;

  beforeEach(async () => {
    setDesktopMatchMedia();
    host = await setupPlaygroundTestHost({
      world: {
        propertyNotes: [
          {
            kind: 'effort',
            slug: 'back-squat',
            label: 'Back Squat',
            aliases: ['bs', 'barbell squat'],
            baseAttributes: {
              met: 7.5,
              discipline: 'strength',
              intensityTier: 'high',
            },
          },
          {
            kind: 'equipment',
            slug: 'kettlebell',
            label: 'Kettlebell',
            aliases: ['kb', 'bell'],
          },
          {
            kind: 'effort',
            slug: 'swing',
            label: 'Swing',
            aliases: ['swings'],
          },
          {
            kind: 'tag',
            slug: 'strength',
            label: 'strength',
          },
        ],
      },
    });
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await host?.cleanup();
    host = undefined;
    if (originalMatchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });

  it('renders nothing when target is null', () => {
    render(<EntityPeekDrawer target={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId(TEST_IDS.ENTITY_PEEK_DRAWER)).toBeNull();
  });

  it('previews an Effort with discipline, MET, intensity, aliases, scoped overrides, top 5 notes, and View all N link', async () => {
    // Seed 6 notes referencing back-squat
    for (let i = 1; i <= 6; i++) {
      await storageService.saveNoteSource({
        noteId: `squat-note-${i}`,
        rawContent: `# Squat Day ${i}\n\n\`\`\`time\n5x5 Back Squat @100kg\n\`\`\`\n`,
        expectedSourceRevision: 0,
        createdAt: 1_700_000_000_000 + i * 1000,
        metadata: { title: `Squat Day ${i}`, type: 'note' },
      });
    }

    await saveScopedPropertyOverride(storageService.storage, {
      targetNotebookId: 'notebook/fall-cycle',
      kind: 'effort',
      slug: 'back-squat',
      rawContent: [
        '---',
        'id: ov-bs',
        'slug: back-squat',
        'label: Back Squat (Paused)',
        'baseAttributes:',
        '  met: 8.0',
        '  discipline: strength',
        '---',
      ].join('\n'),
      title: 'Back Squat (Paused)',
    });

    const onClose = vi.fn();
    render(
      <EntityPeekDrawer
        target={{ kind: 'effort', slug: 'back-squat' }}
        onClose={onClose}
      />,
    );

    const drawer = screen.getByTestId(TEST_IDS.ENTITY_PEEK_DRAWER);
    expect(drawer.tagName).toBe('ASIDE');
    expect(drawer.getAttribute('role')).toBe('complementary');
    expect(drawer.getAttribute('aria-label')).toBe('Entity Peek Drawer');
    expect(drawer.className).toContain('w-[340px]');

    await waitFor(() => {
      expect(drawer.textContent).toContain('Back Squat');
      expect(drawer.textContent).toContain('back-squat');
      expect(drawer.textContent).toContain('strength');
      expect(drawer.textContent).toContain('7.5');
      expect(drawer.textContent).toContain('high');
      expect(drawer.textContent).toContain('barbell squat');
      expect(drawer.textContent).toContain('Scoped Overrides (1)');
      expect(drawer.textContent).toContain('fall-cycle');
      expect(drawer.textContent).toContain('Used in Notes (6)');
    });

    // Top 5 newest notes rendered (Squat Day 6..2), oldest (#1) capped out
    expect(drawer.textContent).toContain('Squat Day 6');
    expect(drawer.textContent).toContain('Squat Day 2');
    expect(drawer.textContent).not.toContain('Squat Day 1');

    const viewAll = screen.getByTestId(TEST_IDS.ENTITY_PEEK_VIEW_ALL_NOTES);
    expect(viewAll.textContent).toContain('View all 6 in Notes →');
    expect(viewAll.getAttribute('href')).toContain('/notes?q=');

    const openFull = screen.getByTestId(TEST_IDS.ENTITY_PEEK_OPEN_FULL);
    expect(openFull.getAttribute('href')).toBe('/effort/back-squat');

    const filterNotes = screen.getByTestId(TEST_IDS.ENTITY_PEEK_FILTER_NOTES);
    expect(filterNotes.getAttribute('href')).toContain('/notes?q=');
    expect(decodeURIComponent(filterNotes.getAttribute('href') ?? '')).toContain(':note{effort:back-squat}');
  });

  it('previews Equipment with aliases and related notes capped at 5', async () => {
    for (let i = 1; i <= 6; i++) {
      await storageService.saveNoteSource({
        noteId: `kb-note-${i}`,
        rawContent: `# KB Session ${i}\n\n\`\`\`time\n20 Kettlebell Swing @24kg\n\`\`\`\n`,
        expectedSourceRevision: 0,
        createdAt: 1_700_000_000_000 + i * 1000,
        metadata: { title: `KB Session ${i}`, type: 'note' },
      });
    }

    render(
      <EntityPeekDrawer
        target={{ kind: 'equipment', slug: 'kettlebell' }}
        onClose={vi.fn()}
      />,
    );

    const drawer = screen.getByTestId(TEST_IDS.ENTITY_PEEK_DRAWER);
    await waitFor(() => {
      expect(drawer.textContent).toContain('Kettlebell');
      expect(drawer.textContent).toContain('kettlebell');
      expect(drawer.textContent).toContain('kb');
      expect(drawer.textContent).toContain('Related Notes (6)');
    });

    const viewAll = screen.getByTestId(TEST_IDS.ENTITY_PEEK_VIEW_ALL_NOTES);
    expect(viewAll.textContent).toContain('View all 6 in Notes →');
    expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_OPEN_FULL).getAttribute('href')).toBe('/equipment/kettlebell');
  });

  it('previews a Tag with category, note count, and top 5 notes', async () => {
    for (let i = 1; i <= 6; i++) {
      await storageService.saveNoteSource({
        noteId: `tag-note-${i}`,
        rawContent: `# Strength Block ${i}\n`,
        expectedSourceRevision: 0,
        createdAt: 1_700_000_000_000 + i * 1000,
        metadata: { title: `Strength Block ${i}`, type: 'note', tags: ['strength'] },
      });
      await storageService.setNoteTags(`tag-note-${i}`, [{ label: 'strength', type: 'domain' }]);
    }

    render(
      <EntityPeekDrawer
        target={{ kind: 'tag', tagType: 'domain', label: 'strength' }}
        onClose={vi.fn()}
      />,
    );

    const drawer = screen.getByTestId(TEST_IDS.ENTITY_PEEK_DRAWER);
    await waitFor(() => {
      expect(drawer.textContent).toContain('#strength');
      expect(drawer.textContent).toContain('domain');
      expect(drawer.textContent).toContain('Top Notes (6)');
      expect(drawer.textContent).toContain('Strength Block 6');
    });

    expect(drawer.textContent).not.toContain('Strength Block 1');
    expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_VIEW_ALL_NOTES).textContent).toContain('View all 6 in Notes →');
    expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_OPEN_FULL).getAttribute('href')).toBe('/t/domain/strength');
  });

  it('creates an Effort, Equipment, or Tag inline from an unrecognized term via commitReferenceNote without leaving the editor', async () => {
    const onCreated = vi.fn();

    // 1. Create Effort
    const { rerender } = render(
      <EntityPeekDrawer
        target={{ kind: 'unrecognized', term: 'ring dip' }}
        onClose={vi.fn()}
        onCreatedReference={onCreated}
      />,
    );

    expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_CREATE_FORM)).toBeDefined();
    expect((screen.getByTestId(TEST_IDS.ENTITY_PEEK_CREATE_LABEL) as HTMLInputElement).value).toBe('Ring Dip');
    expect((screen.getByTestId(TEST_IDS.ENTITY_PEEK_CREATE_SLUG) as HTMLInputElement).value).toBe('ring-dip');

    fireEvent.click(screen.getByTestId(TEST_IDS.ENTITY_PEEK_CREATE_SUBMIT));

    await waitFor(async () => {
      expect(onCreated).toHaveBeenCalledTimes(1);
      const saved = await storageService.getEffort('ring-dip');
      expect(saved?.label).toBe('Ring Dip');
      expect(getAppEffortRegistry().resolve('ring-dip')?.slug).toBe('ring-dip');
    });
    expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_OPEN_FULL).getAttribute('href')).toBe('/effort/ring-dip');

    // 2. Create Equipment
    rerender(
      <EntityPeekDrawer
        target={{ kind: 'unrecognized', term: 'macebell' }}
        onClose={vi.fn()}
        onCreatedReference={onCreated}
      />,
    );

    const kindGroup = screen.getByTestId(TEST_IDS.ENTITY_PEEK_CREATE_KIND);
    fireEvent.click(within(kindGroup).getByRole('button', { name: /^equipment$/i }));
    fireEvent.click(screen.getByTestId(TEST_IDS.ENTITY_PEEK_CREATE_SUBMIT));

    await waitFor(async () => {
      expect(onCreated).toHaveBeenCalledTimes(2);
      const savedEq = await storageService.getEquipment('macebell');
      expect(savedEq?.label).toBe('Macebell');
      expect(getAppEquipmentRegistry().resolve('macebell')?.slug).toBe('macebell');
    });
    expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_OPEN_FULL).getAttribute('href')).toBe('/equipment/macebell');

    // 3. Create Tag
    rerender(
      <EntityPeekDrawer
        target={{ kind: 'unrecognized', term: '#grip-work' }}
        onClose={vi.fn()}
        onCreatedReference={onCreated}
      />,
    );

    const catSelect = screen.getByTestId(TEST_IDS.ENTITY_PEEK_CREATE_CATEGORY) as HTMLSelectElement;
    fireEvent.change(catSelect, { target: { value: 'domain' } });
    fireEvent.click(screen.getByTestId(TEST_IDS.ENTITY_PEEK_CREATE_SUBMIT));

    await waitFor(async () => {
      expect(onCreated).toHaveBeenCalledTimes(3);
      const savedTag = await storageService.getTagByLabel('grip-work');
      expect(savedTag?.label).toBe('grip-work');
      expect(savedTag?.type).toBe('domain');
    });
    expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_OPEN_FULL).getAttribute('href')).toBe('/t/domain/grip-work');
  });

  it('previews a Note with tags, first WOD block preview, M:N schedule count, and session count', async () => {
    const noteId = 'note-fran-1';
    const savedNote = await storageService.saveNoteSource({
      noteId,
      rawContent: '# Fran Benchmark\n\nClassic sprint couplet.\n\n```time\n(21-15-9)\n  Thruster @43kg\n  Pull-up\n```\n',
      expectedSourceRevision: 0,
      metadata: { title: 'Fran Benchmark', type: 'note', tags: ['benchmark', 'conditioning'] },
    });
    const wodBlock = Object.values(savedNote.blocks).find((b) => b.kind === 'wod')!;
    await storageService.setNoteTags(noteId, [{ label: 'benchmark', type: 'format' }]);
    await journalSchedule.scheduleNote({ noteId, date: '2026-11-22' });
    await journalSchedule.scheduleNote({ noteId, date: '2026-11-29' });
    await storageService.saveSession({
      id: 'sess-fran-1',
      noteId,
      blockId: wodBlock.id,
      blockVersion: wodBlock.version,
      noteSourceRevision: savedNote.sourceRevision,
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_198_000,
      duration: 198_000,
      completed: true,
      createdAt: 1_700_000_198_000,
      status: 'completed',
    });

    render(
      <EntityPeekDrawer
        target={{ kind: 'note', noteId }}
        onClose={vi.fn()}
      />,
    );

    const drawer = screen.getByTestId(TEST_IDS.ENTITY_PEEK_DRAWER);
    await waitFor(() => {
      expect(drawer.textContent).toContain('Fran Benchmark');
      expect(drawer.textContent).toContain('#benchmark');
      expect(drawer.textContent).toContain('#conditioning');
      expect(drawer.textContent).toContain('Thruster @43kg');
      expect(drawer.textContent).toContain('2 days');
      expect(drawer.textContent).toContain('1 logged');
    });

    expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_OPEN_FULL).getAttribute('href')).toBe('/note/note-fran-1');
  });

  it('previews a Notebook with description, note count, and recent 5 notes', async () => {
    const nb = await notebookService.create('Fall Strength', 'Heavy barbell progression', '🏋️');
    for (let i = 1; i <= 6; i++) {
      const saved = await storageService.saveNoteSource({
        noteId: `fall-note-${i}`,
        rawContent: `# Week ${i} Squat\n`,
        expectedSourceRevision: 0,
        createdAt: 1_700_000_000_000 + i * 1000,
        metadata: { title: `Week ${i} Squat`, type: 'note' },
      });
      await storageService.saveNote({
        ...saved,
        notebookId: nb.notebookId,
        notebookIds: [nb.notebookId],
      });
    }

    render(
      <EntityPeekDrawer
        target={{ kind: 'notebook', slug: nb.slug }}
        onClose={vi.fn()}
      />,
    );

    const drawer = screen.getByTestId(TEST_IDS.ENTITY_PEEK_DRAWER);
    await waitFor(() => {
      expect(drawer.textContent).toContain('Fall Strength');
      expect(drawer.textContent).toContain('Heavy barbell progression');
      expect(drawer.textContent).toContain('Recent Notes (6)');
      expect(drawer.textContent).toContain('Week 6 Squat');
    });

    expect(drawer.textContent).not.toContain('Week 1 Squat');
    expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_VIEW_ALL_NOTES).textContent).toContain('View all 6 in Notes →');
    expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_OPEN_FULL).getAttribute('href')).toBe(`/notebook/${nb.slug}`);
  });

  it('dismisses on Escape, close button (with mobile min-h-11 target), and backdrop click', async () => {
    const onClose = vi.fn();
    render(
      <EntityPeekDrawer
        target={{ kind: 'effort', slug: 'back-squat' }}
        onClose={onClose}
      />,
    );

    const drawer = screen.getByTestId(TEST_IDS.ENTITY_PEEK_DRAWER);
    await waitFor(() => {
      expect(drawer.textContent).toContain('Back Squat');
    });

    const closeBtn = screen.getByTestId(TEST_IDS.ENTITY_PEEK_CLOSE);
    expect(closeBtn.className).toContain('max-lg:min-h-11');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId(TEST_IDS.ENTITY_PEEK_BACKDROP));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('routes MetricInlinePanel Effort, Equipment, Tag, and unrecognized clicks to onPeekEntity and closes peek on drawer open', () => {
    const onPeekEntity = vi.fn();
    const onClosePeek = vi.fn();
    const onToggleDrawer = vi.fn();

    const statement: ICodeStatement = new ParsedCodeStatement({
      id: 0,
      line: 1,
      raw: '10 Back Squat #strength #mystery-tag Zercher',
      metrics: [
        {
          type: MetricType.Effort,
          value: 'Back Squat',
          image: 'Back Squat',
          origin: 'parser',
          metadata: {
            references: {
              matched: 'whole',
              source: 'Back Squat',
              refs: [
                { kind: 'effort', slug: 'back-squat', label: 'Back Squat' },
                { kind: 'equipment', slug: 'kettlebell', label: 'Kettlebell' },
              ],
            },
          },
        } as IMetric,
        {
          type: 'domain',
          value: 'strength',
          image: '#strength',
          origin: 'parser',
          metadata: {
            tagReference: { slug: 'strength', label: 'strength', functions: [] },
          },
        } as IMetric,
        {
          type: MetricType.Effort,
          value: 'Zercher',
          image: 'Zercher',
          origin: 'parser',
          metadata: {
            references: {
              matched: 'none',
              source: 'Zercher',
              diagnostics: [{ reason: 'unknown-effort', message: 'Unknown effort', token: 'Zercher' }],
            },
          },
        } as IMetric,
        {
          type: MetricType.Custom,
          value: '#mystery-tag',
          image: '#mystery-tag',
          origin: 'parser',
        } as IMetric,
      ] as unknown as ConstructorParameters<typeof ParsedCodeStatement>[0]['metrics'],
    });

    const section: EditorSection = {
      id: 's1',
      type: 'time',
      from: 0,
      to: 60,
      contentFrom: 8,
      contentTo: 55,
      startLine: 1,
      endLine: 3,
    };

    const mockView = {
      coordsAtPos: () => ({ top: 20, bottom: 40, left: 10, right: 80 }),
      dom: { getBoundingClientRect: () => ({ top: 0, left: 0, width: 600, height: 240 }) },
      contentDOM: { getBoundingClientRect: () => ({ left: 0, width: 600 }) },
      state: {} as unknown as EditorState,
    };

    render(
      <MetricInlinePanel
        view={mockView as unknown as EditorView}
        cursorVersion={1}
        drawerOpen={false}
        onPeekEntity={onPeekEntity}
        onClosePeek={onClosePeek}
        onToggleDrawer={onToggleDrawer}
        getCursorFocusState={() => ({
          section,
          statement,
          cursorLine: 2,
          lineFrom: 8,
          lineTo: 52,
          focusedMetric: null,
        })}
      />,
    );

    fireEvent.click(screen.getByText('Back Squat').closest('button')!);
    expect(onPeekEntity).toHaveBeenLastCalledWith({
      kind: 'effort',
      slug: 'back-squat',
      label: 'Back Squat',
    });

    fireEvent.click(screen.getByText('Kettlebell').closest('button')!);
    expect(onPeekEntity).toHaveBeenLastCalledWith({
      kind: 'equipment',
      slug: 'kettlebell',
      label: 'Kettlebell',
    });

    fireEvent.click(screen.getByText('strength').closest('button')!);
    expect(onPeekEntity).toHaveBeenLastCalledWith({
      kind: 'tag',
      label: 'strength',
    });

    fireEvent.click(screen.getByTestId('editor-define-token'));
    expect(onPeekEntity).toHaveBeenLastCalledWith({
      kind: 'unrecognized',
      term: 'Zercher',
    });

    fireEvent.click(screen.getByText('#mystery-tag'));
    expect(onPeekEntity).toHaveBeenLastCalledWith({
      kind: 'unrecognized',
      term: '#mystery-tag',
    });

    // Opening Token Inspector Drawer calls onClosePeek
    fireEvent.click(screen.getByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER_TOGGLE));
    expect(onClosePeek).toHaveBeenCalledTimes(1);
    expect(onToggleDrawer).toHaveBeenCalledTimes(1);
  });

  it('enforces mutual exclusion between NoteEditor WhiteboardInspectorDrawer and EntityPeekDrawer, and preserves normal cursor clicks in edit mode', async () => {
    const doc = '# Strength\n\n```time\n10 Back Squat @100kg\n```';
    let editorView: EditorView | undefined;

    function TestNoteSurface() {
      const [peekTarget, setPeekTarget] = useState<EntityPeekTarget | null>(null);
      return (
        <div>
          <NoteEditor
            value={doc}
            onChange={() => {}}
            onPeekEntity={(t) => setPeekTarget(t)}
            onClosePeek={() => setPeekTarget(null)}
            onViewCreated={(v) => {
              editorView = v;
            }}
          />
          <EntityPeekDrawer
            target={peekTarget}
            onClose={() => setPeekTarget(null)}
          />
        </div>
      );
    }

    render(<TestNoteSurface />);
    expect(editorView).toBeDefined();

    const coordsSpy = vi.spyOn(editorView!, 'coordsAtPos').mockReturnValue({
      left: 24,
      right: 160,
      top: 24,
      bottom: 44,
    });

    try {
      const squatOffset = doc.indexOf('Back Squat') + 2;
      act(() => {
        editorView!.dispatch({ selection: { anchor: squatOffset } });
        editorView!.focus();
      });

      // 1. Open WhiteboardInspectorDrawer first
      const drawerToggle = await screen.findByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER_TOGGLE);
      act(() => {
        fireEvent.click(drawerToggle);
      });
      expect(await screen.findByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER)).toBeDefined();
      expect(screen.queryByTestId(TEST_IDS.ENTITY_PEEK_DRAWER)).toBeNull();

      // 2. Plain click in editor body does NOT hijack normal editing to open peek
      const posSpy = vi.spyOn(editorView!, 'posAtCoords').mockReturnValue(squatOffset);
      act(() => {
        fireEvent.click(editorView!.contentDOM, { button: 0 });
      });
      expect(screen.queryByTestId(TEST_IDS.ENTITY_PEEK_DRAWER)).toBeNull();

      // 3. Clicking Back Squat pill in MetricInlinePanel opens EntityPeekDrawer AND closes WhiteboardInspectorDrawer
      const strip = await screen.findByTestId(TEST_IDS.EDITOR_TOKEN_STRIP);
      const effortBtn = within(strip).getByText('Back Squat').closest('button')!;
      act(() => {
        fireEvent.click(effortBtn);
      });

      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_DRAWER)).toBeDefined();
        expect(screen.queryByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER)).toBeNull();
      });

      // 4. Re-opening WhiteboardInspectorDrawer closes EntityPeekDrawer
      act(() => {
        fireEvent.click(screen.getByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER_TOGGLE));
      });
      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER)).toBeDefined();
        expect(screen.queryByTestId(TEST_IDS.ENTITY_PEEK_DRAWER)).toBeNull();
      });

      // 5. Ctrl+Click on an editor reference opens EntityPeekDrawer and closes WhiteboardInspectorDrawer
      act(() => {
        fireEvent.click(editorView!.contentDOM, { button: 0, ctrlKey: true });
      });
      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_DRAWER)).toBeDefined();
        expect(screen.queryByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER)).toBeNull();
      });

      // 6. WebMCP peekBridge exposes status/open/close cleanly
      const bridge = getActivePeekBridge();
      expect(bridge).not.toBeNull();
      expect(bridge!.getTarget()).toEqual({
        kind: 'effort',
        slug: 'back-squat',
        label: 'Back Squat',
      });

      act(() => {
        bridge!.openPeek({ kind: 'equipment', slug: 'kettlebell' });
      });
      await waitFor(() => {
        expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_DRAWER).textContent).toContain('Kettlebell');
      });

      act(() => {
        bridge!.closePeek();
      });
      await waitFor(() => {
        expect(screen.queryByTestId(TEST_IDS.ENTITY_PEEK_DRAWER)).toBeNull();
      });

      posSpy.mockRestore();
    } finally {
      coordsSpy.mockRestore();
    }
  });

  it('triggers onPeekEntity on plain click in readonly mode for inline references and frontmatter URLs', async () => {
    const doc = '---\ntitle: Read Mode\n---\n\n```time\n10 Back Squat\n```\n';
    const onPeekEntity = vi.fn();
    let editorView: EditorView | undefined;

    render(
      <NoteEditor
        value={doc}
        onChange={() => {}}
        readonly
        onPeekEntity={onPeekEntity}
        onViewCreated={(v) => {
          editorView = v;
        }}
      />,
    );
    expect(editorView).toBeDefined();

    const squatOffset = doc.indexOf('Back Squat') + 2;
    const posSpy = vi.spyOn(editorView!, 'posAtCoords').mockReturnValue(squatOffset);
    try {
      act(() => {
        fireEvent.click(editorView!.contentDOM, { button: 0 });
      });
      expect(onPeekEntity).toHaveBeenCalledWith({
        kind: 'effort',
        slug: 'back-squat',
        label: 'Back Squat',
      });
    } finally {
      posSpy.mockRestore();
    }

    expect(parseEntityPeekUrl('/effort/back-squat')).toEqual({ kind: 'effort', slug: 'back-squat' });
    expect(parseEntityPeekUrl('/equipment/kettlebell')).toEqual({ kind: 'equipment', slug: 'kettlebell' });
    expect(parseEntityPeekUrl('/t/domain/strength')).toEqual({ kind: 'tag', tagType: 'domain', label: 'strength' });
    expect(parseEntityPeekUrl('/note/abc-123')).toEqual({ kind: 'note', noteId: 'abc-123' });
    expect(parseEntityPeekUrl('/notebook/fall-cycle')).toEqual({ kind: 'notebook', slug: 'fall-cycle' });
    expect(parseEntityPeekUrl('/day/2026-11-22')).toEqual({ kind: 'day', date: '2026-11-22' });
  });

  it('registers ui_peek_entity in Playground UI WebMCP tool manifest with valid schema', async () => {
    const manifest = exportPlaygroundUiToolsManifest();
    const peekEntry = manifest.find((t) => t.name === 'ui_peek_entity');
    expect(peekEntry).toBeDefined();
    expect(peekEntry!.tier).toBe(1);
    expect(peekEntry!.surfaces).toEqual(['webmcp']);
    expect(peekEntry!.mountScope).toBeTruthy();

    expect(uiPeekEntitySchema.safeParse({ action: 'status' }).success).toBe(true);
    expect(
      uiPeekEntitySchema.safeParse({ action: 'open', kind: 'effort', slug: 'back-squat' }).success,
    ).toBe(true);
    expect(
      uiPeekEntitySchema.safeParse({ action: 'open', kind: 'unrecognized', term: 'ring dip' }).success,
    ).toBe(true);
    expect(uiPeekEntitySchema.safeParse({ action: 'close' }).success).toBe(true);
    expect(
      uiPeekEntitySchema.safeParse({ action: 'open', kind: 'day', date: 'not-a-date' }).success,
    ).toBe(false);

    // Also verify router navigation integration inside PlaygroundHost
    let renderResult: Awaited<ReturnType<typeof renderWithPlaygroundHost>> | undefined;
    try {
      renderResult = await renderWithPlaygroundHost(
        <EntityPeekDrawer
          target={{ kind: 'effort', slug: 'back-squat' }}
          onClose={vi.fn()}
        />,
        { route: '/note/test-note' },
      );
      expect(screen.getByTestId(TEST_IDS.ENTITY_PEEK_OPEN_FULL).getAttribute('href')).toBe('/effort/back-squat');
    } finally {
      await renderResult?.cleanup();
    }
  });
});
