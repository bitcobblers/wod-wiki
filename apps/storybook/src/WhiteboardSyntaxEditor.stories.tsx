import React, { useLayoutEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { startCompletion } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { TEST_IDS } from '@/lib/testIds';

const WORKOUT_DOC = [
  '---',
  'title: Kettlebell Conditioning',
  'metrics.effort: kettlebell-swing',
  '---',
  '',
  '# Kettlebell Conditioning',
  '',
  'Pair this with [[Benchmark Day]] when tracking weekly power output #conditioning.',
  '',
  '```time',
  '(3)',
  '  10:00 15 Kettlebell Swing @24kg',
  '  *1:00 Rest',
  '```',
  '',
].join('\n');

const REPAIR_DOC = [
  '# Syntax Repair Sample',
  '',
  '```time',
  '21-15-9 Kettlebell Swing @24kg',
  ':rest',
  '```',
  '',
].join('\n');

const PROSE_DOC = [
  '# Conditioning Notes',
  '',
  'See [[',
  'Try typing # for inline tags without affecting Markdown headings.',
  '',
  '```time',
  '10:00 EMOM',
  '  [:rest]',
  '```',
  '',
].join('\n');

function StoryEditorHarness({
  initialDoc,
  testId,
  theme = 'light',
  defaultDrawerOpen = false,
  drawerLayout = 'docked-right',
  onViewReady,
}: {
  initialDoc: string;
  testId: string;
  theme?: 'light' | 'dark';
  defaultDrawerOpen?: boolean;
  drawerLayout?: 'docked-right' | 'inline';
  onViewReady?: (view: EditorView) => void;
}) {
  const [doc, setDoc] = useState(initialDoc);
  return (
    <div
      data-testid={testId}
      className={
        theme === 'dark'
          ? 'dark rounded-xl border border-border bg-background p-4 text-foreground max-w-5xl mx-auto'
          : 'rounded-xl border border-border bg-background p-4 text-foreground max-w-5xl mx-auto'
      }
    >
      <NoteEditor
        value={doc}
        onChange={setDoc}
        theme={theme}
        enablePreview
        enableLinting
        defaultInspectorDrawerOpen={defaultDrawerOpen}
        inspectorDrawerLayout={drawerLayout}
        onViewCreated={onViewReady}
      />
    </div>
  );
}

function MobileFrame({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const orig = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    setReady(true);
    return () => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: orig,
      });
    };
  }, []);

  return (
    <div className="mx-auto w-[390px] max-w-full min-h-[760px] rounded-2xl border border-border bg-background overflow-hidden">
      {ready ? children : null}
    </div>
  );
}

function getEditorView(root: HTMLElement): EditorView {
  const host = (root.querySelector('.cm-note-editor') ?? root.querySelector('.cm-editor')) as {
    __codemirrorView?: EditorView;
  } | null;
  if (host?.__codemirrorView) return host.__codemirrorView;
  const cm = root.querySelector('.cm-editor') as { __codemirrorView?: EditorView } | null;
  if (!cm?.__codemirrorView) throw new Error('CodeMirror EditorView not found on story host');
  return cm.__codemirrorView;
}

const meta: Meta<typeof NoteEditor> = {
  title: 'Organisms/WhiteboardSyntaxEditor',
  component: NoteEditor,
  parameters: {
    layout: 'padded',
    domainState: 'populatedJournal',
  },
};

export default meta;
type Story = StoryObj<typeof NoteEditor>;

export const OptionAAnchoredInspector: Story = {
  name: 'Option A: Anchored Token Strip & Popover',
  render: () => (
    <StoryEditorHarness
      testId="wb-option-a-story"
      initialDoc={WORKOUT_DOC}
    />
  ),
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-testid="wb-option-a-story"]')!;
    await waitFor(() => expect(root.querySelector('.cm-content')).toBeVisible());
    const view = getEditorView(root);

    const pos = WORKOUT_DOC.indexOf('10:00') + 2;
    view.dispatch({ selection: { anchor: pos } });
    view.focus();

    const strip = await within(root).findByTestId(TEST_IDS.EDITOR_TOKEN_STRIP);
    const firstChip = strip.querySelector<HTMLButtonElement>('button[data-inspector-trigger="true"]');
    await expect(firstChip).toBeTruthy();

    await userEvent.click(firstChip!);
    const popover = await within(root).findByTestId(TEST_IDS.EDITOR_INSPECTOR_POPOVER);
    await expect(popover).toBeVisible();

    const restBtn = await within(popover).findByRole('button', { name: /Rest \(\*1:00\)/i });
    await userEvent.click(restBtn);
    await waitFor(() => {
      expect(view.state.doc.toString()).toContain('*10:00');
    });
  },
};

export const OptionBInspectorDrawer: Story = {
  name: 'Option B: Docked Right Inspector Drawer & Block Timeline',
  render: () => (
    <StoryEditorHarness
      testId="wb-option-b-story"
      initialDoc={WORKOUT_DOC}
      defaultDrawerOpen
      drawerLayout="inline"
    />
  ),
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-testid="wb-option-b-story"]')!;
    await waitFor(() => expect(root.querySelector('.cm-content')).toBeVisible());
    const view = getEditorView(root);

    const pos = WORKOUT_DOC.indexOf('@24kg') + 1;
    view.dispatch({ selection: { anchor: pos } });
    view.focus();

    const drawer = await within(root).findByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER);
    await expect(drawer).toBeVisible();

    const timelineRows = await within(drawer).findAllByTestId(TEST_IDS.EDITOR_BLOCK_TIMELINE_ROW);
    await expect(timelineRows.length).toBeGreaterThanOrEqual(2);
  },
};

export const InlineRepairAndFuzzyCatalog: Story = {
  name: 'Inline Syntax Lint Repair (:rest & Ladder)',
  render: () => (
    <StoryEditorHarness
      testId="wb-repair-story"
      initialDoc={REPAIR_DOC}
    />
  ),
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-testid="wb-repair-story"]')!;
    await waitFor(() => expect(root.querySelector('.cm-content')).toBeVisible());
    const view = getEditorView(root);

    view.dispatch({ selection: { anchor: REPAIR_DOC.indexOf(':rest') + 2 } });
    view.focus();

    const quickFixBtns = await within(root).findAllByTestId(TEST_IDS.EDITOR_LINT_QUICK_FIX);
    await expect(quickFixBtns.length).toBeGreaterThan(0);

    await userEvent.click(quickFixBtns[0]!);
    await waitFor(() => {
      expect(view.state.doc.toString()).toContain('*1:00');
    });
  },
};

export const ProseWikiAndAutocomplete: Story = {
  name: 'Markdown Prose [[Wiki Links]], #tags & [:Cue] Completions',
  render: () => (
    <StoryEditorHarness
      testId="wb-prose-autocomplete-story"
      initialDoc={PROSE_DOC}
    />
  ),
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-testid="wb-prose-autocomplete-story"]')!;
    await waitFor(() => expect(root.querySelector('.cm-content')).toBeVisible());
    const view = getEditorView(root);

    const wikiPos = PROSE_DOC.indexOf('[[') + 2;
    view.dispatch({ selection: { anchor: wikiPos } });
    view.focus();
    startCompletion(view);

    await waitFor(() => {
      const tooltip = document.querySelector('.cm-tooltip-autocomplete');
      expect(tooltip).not.toBeNull();
    });
  },
};

export const MobileThumbDeck: Story = {
  name: 'Mobile 3-Region Thumb Deck (390px)',
  render: () => (
    <MobileFrame>
      <StoryEditorHarness
        testId="wb-mobile-deck-story"
        initialDoc={WORKOUT_DOC}
      />
    </MobileFrame>
  ),
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-testid="wb-mobile-deck-story"]')!;
    await waitFor(() => expect(root.querySelector('.cm-content')).toBeVisible());
    const view = getEditorView(root);

    view.dispatch({ selection: { anchor: WORKOUT_DOC.indexOf('10:00') + 1 } });
    (view.contentDOM as HTMLElement).focus();

    const deck = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-testid="mobile-wheel-composer"]');
      expect(el).not.toBeNull();
      return el!;
    });
    await expect(within(deck).getByTestId(TEST_IDS.EDITOR_TOKEN_DELETE_BTN)).toBeVisible();
  },
};

export const DarkModeArcticFrost: Story = {
  name: 'Dark Mode (Arctic Frost) Inspector & Drawer',
  render: () => (
    <StoryEditorHarness
      testId="wb-dark-frost-story"
      initialDoc={WORKOUT_DOC}
      theme="dark"
      defaultDrawerOpen
      drawerLayout="inline"
    />
  ),
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-testid="wb-dark-frost-story"]')!;
    await waitFor(() => expect(root.querySelector('.cm-content')).toBeVisible());
    const view = getEditorView(root);

    view.dispatch({ selection: { anchor: WORKOUT_DOC.indexOf('Kettlebell Swing') + 2 } });
    view.focus();

    const drawer = await within(root).findByTestId(TEST_IDS.EDITOR_INSPECTOR_DRAWER);
    await expect(drawer).toBeVisible();
  },
};
