import { useMemo, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { startCompletion } from '@codemirror/autocomplete';
import { Edit3 } from 'lucide-react';
import { EditorDialog } from '@bitcobblers/wod-wiki-ui';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import type { WidgetRegistry } from '@/components/Editor/widgets/types';
import { createAttentionWidgetWrapper } from '@app/components/widgets/widgetWrappers';
import { useNoteEditor } from './workbench/LanguageWorkbench';
import { MetricInlinePanel } from '@/components/organisms/editor/MetricInlinePanel';

/**
 * Editable completion sample: frontmatter, a nested ```query body, and
 * ```time / ```log bodies — one note, every completion surface. Typing in the
 * fences opens the real preset completions; frontmatter and prose stay plain
 * Markdown.
 */
const NOTE_COMPLETION_SAMPLE = [
  '---',
  'title: Benchmark Day',
  'date: 2026-10-24',
  '---',
  '',
  '# Benchmark Day',
  '',
  'Frontmatter and prose stay plain Markdown — query and workout',
  'completions belong inside the fences below.',
  '',
  '```query',
  ':journal{} last 4w | :sum{metric:tis} | :bar{}',
  '```',
  '',
  '```wql',
  ':note{tags:benchmark} last 8w',
  '```',
  '',
  '```time',
  '(3)',
  '  10 Power Cleans 135 lb',
  '  12 Pull-ups',
  '  * :90 Rest',
  '```',
  '',
  '```log',
  '5x5 Back Squat @100kg',
  '```',
].join('\n');

const THRUSTER_EFFORT_PROPERTY_NOTE = [
  '---',
  'id: effort-bundled-thruster',
  'slug: thruster',
  'label: Thruster',
  'aliases:',
  '  - thrusters',
  '  - barbell thruster',
  '  - Weighted Thrusters',
  'discipline: weightlifting',
  'intensityTier: high',
  'metrics.met: 8',
  'metrics.work: reps * resistance',
  'summaries.totalWork: sum(work)',
  '---',
  '',
  '# Thruster',
  '',
  'Compound front-squat to overhead press. Expand **Properties** above to inspect the three distinct alias pills (`thrusters`, `barbell thruster`, `Weighted Thrusters`), `metrics.met`, and `summaries.totalWork`.',
  '',
  '```query',
  ':note{effort:thruster} last 8w',
  '```',
].join('\n');

function NoteEditorSurface({
  doc,
  testId = 'note-editor-host',
}: {
  doc: string;
  testId?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const { view, cursorVersion } = useNoteEditor(host, doc, () => {});
  return (
    <>
      <div
        ref={host}
        data-testid={testId}
        className="cm-note-editor min-h-72 overflow-hidden rounded-lg border border-border/60 bg-background/70 shadow-inner text-sm"
      />
      <MetricInlinePanel view={view} cursorVersion={cursorVersion} />
    </>
  );
}

interface NoteEditorStoryArgs {
  initialDoc: string;
  mode: 'edit' | 'read';
}

function UniversalNoteEditorHarness({ initialDoc, mode: initialMode }: NoteEditorStoryArgs) {
  const [mode, setMode] = useState<'read' | 'edit'>(initialMode);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <header className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <div className="text-xs font-mono uppercase text-muted-foreground">Playground / Organisms / Editor</div>
          <h1 className="text-lg font-bold text-foreground">Universal Note Editor</h1>
        </div>
        <div className="flex border border-border rounded-lg p-0.5 bg-muted/40 text-xs font-medium">
          <button
            type="button"
            onClick={() => setMode('read')}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              mode === 'read' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'
            }`}
          >
            Read
          </button>
          <button
            type="button"
            onClick={() => setMode('edit')}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              mode === 'edit' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'
            }`}
          >
            Edit
          </button>
        </div>
      </header>

      <div className="border border-border rounded-xl bg-card p-6 shadow-sm">
        {mode === 'edit' ? (
          <NoteEditorSurface doc={initialDoc} />
        ) : (
          <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
            {initialDoc}
          </pre>
        )}
      </div>
    </div>
  );
}

function NoteEditorDialogHarness({ initialDoc }: { initialDoc: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-[320px] w-full items-center justify-center bg-background text-foreground font-sans">
      <button
        type="button"
        data-testid="note-dialog-open"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        <Edit3 className="size-4" /> Edit note
      </button>
      <EditorDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Edit note"
        description="Completion menus float above this dialog, and Escape dismisses the menu before the dialog."
      >
        <NoteEditorSurface doc={initialDoc} testId="note-dialog-editor" />
      </EditorDialog>
    </div>
  );
}

interface CodeMirrorTarget {
  state: {
    doc: {
      lines: number;
      line: (no: number) => { from: number; to: number; text: string };
      toString: () => string;
    };
  };
  dispatch: (tr: { changes?: { from: number; to: number; insert: string }; selection?: { anchor: number } }) => void;
  focus: () => void;
}

interface CmDomHost {
  __codemirrorView?: CodeMirrorTarget;
  cmTile?: { root?: { view?: CodeMirrorTarget } };
}

function getCmView(rootEl?: HTMLElement | null): CodeMirrorTarget {
  const root =
    rootEl ??
    document.querySelector('[data-testid="note-editor-host"]') ??
    document.querySelector('[data-testid="note-dialog-editor"]');
  const editor = root?.querySelector('.cm-editor') ?? document.querySelector('.cm-editor');
  const content = editor?.querySelector('.cm-content');
  const view =
    (root as unknown as CmDomHost | null)?.__codemirrorView ??
    (editor as unknown as CmDomHost | null)?.__codemirrorView ??
    (content as unknown as CmDomHost | null)?.cmTile?.root?.view;
  if (!view) throw new Error('note editor view not found');
  return view;
}

function gotoLine(lineNumber: number, host?: HTMLElement | null) {
  const root =
    host ??
    (document.querySelector('[data-testid="note-editor-host"]') as HTMLElement | null) ??
    (document.querySelector('[data-testid="note-dialog-editor"]') as HTMLElement | null);
  const firstLine = root?.querySelector('.cm-line');
  if (firstLine instanceof HTMLElement) {
    firstLine.click();
  }
  const view = getCmView(root);
  const target = view.state.doc.line(lineNumber);
  view.dispatch({ selection: { anchor: target.to } });
  view.focus();
}

const LINE = { queryBody: 12, wqlBody: 16, timeBodyRest: 23, prose: 8, frontmatterDate: 3 };

function openBodyLine(lineNumber: number, host?: HTMLElement | null) {
  gotoLine(lineNumber, host);
  const view = getCmView(host);
  const prevText = lineNumber > 1 ? view.state.doc.line(lineNumber - 1).text.trim() : '';
  if (lineNumber === LINE.queryBody || prevText.startsWith('```query')) {
    const scope =
      host ??
      (document.querySelector('[data-testid="note-editor-host"]') as HTMLElement | null) ??
      (document.querySelector('[data-testid="note-dialog-editor"]') as HTMLElement | null);
    const sourceBtn = scope?.querySelector('[data-testid="query-edit-source"]') as HTMLElement | null;
    if (sourceBtn && sourceBtn.offsetParent !== null) {
      sourceBtn.click();
    }
  }
  const latestView = getCmView(host);
  const target = latestView.state.doc.line(lineNumber);
  latestView.dispatch({
    changes: { from: target.from, to: target.to, insert: '' },
    selection: { anchor: target.from },
  });
  latestView.focus();
}

function findFenceBodyLine(view: CodeMirrorTarget, fencePrefix: string): number {
  for (let i = 1; i < view.state.doc.lines; i++) {
    if (view.state.doc.line(i).text.trim().startsWith(fencePrefix)) {
      return i + 1;
    }
  }
  throw new Error(`Fence ${fencePrefix} not found in document`);
}

function autocompleteMenu() {
  return document.querySelector<HTMLElement>('.cm-tooltip-autocomplete');
}

function firstOptionLabel() {
  return autocompleteMenu()?.querySelector<HTMLElement>('li[aria-selected="true"] .cm-completionLabel');
}

async function settleCompletion(ms = 200) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestCompletion(view: CodeMirrorTarget) {
  await userEvent.keyboard('{Control>}[Space]{/Control}');
  if (!autocompleteMenu()) {
    startCompletion(view as unknown as Parameters<typeof startCompletion>[0]);
  }
}

const meta: Meta<NoteEditorStoryArgs> = {
  id: 'screens',
  title: 'Playground/Organisms/Editor/NoteEditor',
  component: UniversalNoteEditorHarness,
  parameters: {
    domainState: 'populatedJournal',
  },
  args: {
    initialDoc: NOTE_COMPLETION_SAMPLE,
    mode: 'edit',
  },
  argTypes: {
    initialDoc: {
      control: 'text',
      description: 'Markdown note content with frontmatter, ```query, ```wql, ```time, and ```log fences',
    },
    mode: {
      control: 'inline-radio',
      options: ['edit', 'read'],
      description: 'Toggle between interactive CodeMirror 6 editor and raw Markdown readout',
    },
  },
};

export default meta;
type Story = StoryObj<NoteEditorStoryArgs>;

export const UniversalNoteEditor: Story = {
  name: 'Universal Note Editor',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('note-editor-host')).toBeVisible();
    await expect(canvas.getByText('Benchmark Day')).toBeVisible();
    // Parity gate: default pipeline query executes cleanly without pipeline-unsupported error
    await waitFor(() => {
      expect(canvas.queryByText(/loading…/i)).toBeNull();
    });
    await expect(canvas.queryByText(/pipeline queries are not supported/i)).toBeNull();
    await expect(canvas.queryByText(/query execution error/i)).toBeNull();
  },
};

export const UniversalNoteEditorDialog: Story = {
  name: 'Universal Note Editor Dialog',
  render: (args) => <NoteEditorDialogHarness initialDoc={args.initialDoc} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const openBtn = canvas.getByTestId('note-dialog-open');
    await userEvent.click(openBtn);

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeVisible();
      expect(document.querySelector('[data-testid="note-dialog-editor"]')).toBeVisible();
    });

    const dialogHost = document.querySelector<HTMLElement>('[data-testid="note-dialog-editor"]');
    openBodyLine(LINE.queryBody, dialogHost);
    await userEvent.keyboard(':no');

    await waitFor(() => {
      expect(autocompleteMenu()).toBeVisible();
      expect(firstOptionLabel()?.textContent?.trim()).toBe('note');
    });

    // Tooltip floats within viewport above dialog panel
    await waitFor(() => {
      const menuEl = autocompleteMenu();
      expect(menuEl).not.toBeNull();
      const box = menuEl!.getBoundingClientRect();
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(window.innerHeight || 1000);
    });

    // Accept into the doc
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeNull();
    });
    const view = getCmView(dialogHost);
    expect(view.state.doc.toString()).toContain(':note{');

    // First Escape dismisses the menu, second closes the dialog
    openBodyLine(LINE.queryBody, dialogHost);
    await userEvent.keyboard(':no');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeVisible();
    });

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeNull();
      expect(document.querySelector('[role="dialog"]')).toBeVisible();
    });

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
  },
};

export const CompletionNestedWqlQuery: Story = {
  name: 'Completion: Nested WQL in ```query',
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>('[data-testid="note-editor-host"]') ?? canvasElement;
    openBodyLine(LINE.queryBody, host);
    await userEvent.keyboard(':no');

    await waitFor(() => {
      expect(autocompleteMenu()).toBeVisible();
      expect(firstOptionLabel()?.textContent?.trim()).toBe('note');
    });

    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeNull();
    });
    const view = getCmView(host);
    expect(view.state.doc.toString()).toContain(':note{');

    // Filter keys inside the braces
    await userEvent.keyboard('t');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeVisible();
      const labels = Array.from(autocompleteMenu()?.querySelectorAll('.cm-completionLabel') || []).map((l) =>
        l.textContent?.trim(),
      );
      expect(labels).toContain('text');
    });

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeNull();
    });
  },
};

export const CompletionNestedWqlWql: Story = {
  name: 'Completion: Nested WQL in ```wql',
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>('[data-testid="note-editor-host"]') ?? canvasElement;
    openBodyLine(LINE.wqlBody, host);
    await userEvent.keyboard(':no');

    await waitFor(() => {
      expect(autocompleteMenu()).toBeVisible();
      expect(firstOptionLabel()?.textContent?.trim()).toBe('note');
    });

    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeNull();
    });
    const view = getCmView(host);
    expect(view.state.doc.toString()).toContain(':note{');

    // Filter keys inside the braces
    await userEvent.keyboard('t');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeVisible();
      const labels = Array.from(autocompleteMenu()?.querySelectorAll('.cm-completionLabel') || []).map((l) =>
        l.textContent?.trim(),
      );
      expect(labels).toContain('text');
    });

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeNull();
    });
  },
};

export const CompletionTimeBodyStructureAndUnits: Story = {
  name: 'Completion: Time Body Structure, Unit, and Property',
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>('[data-testid="note-editor-host"]') ?? canvasElement;

    // 1. Structure snippet
    openBodyLine(LINE.timeBodyRest, host);
    await userEvent.keyboard('circ');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeVisible();
      expect(firstOptionLabel()?.textContent?.trim()).toBe('Circuit');
    });
    await userEvent.keyboard('{Enter}');
    const view = getCmView(host);
    await waitFor(() => {
      expect(view.state.doc.toString()).toContain('Air Squats');
    });

    // 2. Unit completion after number
    openBodyLine(LINE.timeBodyRest, host);
    await userEvent.keyboard('100 k');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeVisible();
      const kg = Array.from(autocompleteMenu()?.querySelectorAll('.cm-completionLabel') || []).find(
        (l) => l.textContent?.trim() === 'kg',
      );
      expect(kg).toBeDefined();
    });
    const kgEl = Array.from(autocompleteMenu()?.querySelectorAll('.cm-completionLabel') || []).find(
      (l) => l.textContent?.trim() === 'kg',
    )!;
    await userEvent.click(kgEl);
    await waitFor(() => {
      expect(autocompleteMenu()).toBeNull();
      expect(view.state.doc.toString()).toContain('100 kg');
    });

    // 3. Property completion on empty line
    openBodyLine(LINE.timeBodyRest, host);
    await userEvent.keyboard('soun');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeVisible();
      expect(firstOptionLabel()?.textContent?.trim()).toBe('sound');
    });
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(view.state.doc.toString()).toContain('sound');
    });
  },
};

export const CompletionTimeBodyEffort: Story = {
  name: 'Completion: Time Body Effort Canonical Detail',
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>('[data-testid="note-editor-host"]') ?? canvasElement;
    openBodyLine(LINE.timeBodyRest, host);
    await userEvent.keyboard('Thr');

    await waitFor(() => {
      expect(autocompleteMenu()).toBeVisible();
      const rows = Array.from(autocompleteMenu()?.querySelectorAll('li') || []);
      const thrRow = rows.find((r) => r.textContent?.includes('Thrusters'));
      expect(thrRow).toBeDefined();
      expect(thrRow?.querySelector('.cm-completionDetail')?.textContent?.trim()).toBe('thruster');
    });

    await userEvent.keyboard('{Enter}');
    const view = getCmView(host);
    await waitFor(() => {
      expect(view.state.doc.toString()).toContain('Thrusters');
    });
  },
};

export const CompletionChoiceDeduplication: Story = {
  name: 'Completion: Deduplication and Choice Slot Persistence',
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>('[data-testid="note-editor-host"]') ?? canvasElement;
    const view = getCmView(host);

    // 1. Duplicate effort rejection
    openBodyLine(LINE.timeBodyRest, host);
    await userEvent.keyboard('10 Push Ups ');
    await requestCompletion(view);
    await settleCompletion();
    expect(autocompleteMenu()).toBeNull();

    // 2. Pipe re-opens directives
    openBodyLine(LINE.timeBodyRest, host);
    await userEvent.keyboard('10 Push Ups | ');
    await requestCompletion(view);
    await waitFor(() => {
      expect(autocompleteMenu()).toBeVisible();
      const labels = Array.from(autocompleteMenu()?.querySelectorAll('.cm-completionLabel') || []).map((l) =>
        l.textContent?.trim(),
      );
      expect(labels).toContain('AMRAP');
    });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeNull();
    });

    // 3. Units deduplication: effort/directive completions remain open without kg/lb
    openBodyLine(LINE.timeBodyRest, host);
    await userEvent.keyboard('10 kg ');
    await requestCompletion(view);
    await waitFor(() => {
      const menu = autocompleteMenu();
      expect(menu).toBeVisible();
      const labels = Array.from(menu!.querySelectorAll('.cm-completionLabel')).map((l) =>
        l.textContent?.trim(),
      );
      expect(labels).toContain('AMRAP');
      expect(labels).toContain('EMOM');
      expect(labels).toContain('FOR TIME');
      expect(labels).not.toContain('kg');
      expect(labels).not.toContain('lb');
    });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeNull();
    });
  },
};

export const CompletionKeyboardNavigation: Story = {
  name: 'Completion: Arrow Key Navigation and Escape Dismissal',
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>('[data-testid="note-editor-host"]') ?? canvasElement;
    openBodyLine(LINE.queryBody, host);
    await userEvent.keyboard(':no');

    await waitFor(() => {
      expect(autocompleteMenu()).toBeVisible();
      expect(firstOptionLabel()?.textContent?.trim()).toBe('note');
    });

    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(firstOptionLabel()?.textContent?.trim()).toBe('notes');
    });

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeNull();
    });
    const lines = Array.from(host.querySelectorAll('.cm-line')).map((l) => l.textContent?.trim());
    expect(lines).not.toContain(':note{');
  },
};

export const CompletionSectionIsolation: Story = {
  name: 'Completion: Section Isolation across Frontmatter, Prose, and Fences',
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector<HTMLElement>('[data-testid="note-editor-host"]') ?? canvasElement;
    const view = getCmView(host);

    // 1. Prose stays inert
    openBodyLine(LINE.prose, host);
    await userEvent.keyboard(':no');
    await settleCompletion();
    expect(autocompleteMenu()).toBeNull();

    gotoLine(LINE.prose, host);
    await userEvent.keyboard('{Enter}circ');
    await settleCompletion();
    expect(autocompleteMenu()).toBeNull();

    // 2. Frontmatter stays inert
    gotoLine(LINE.frontmatterDate, host);
    await userEvent.keyboard(' :no');
    await settleCompletion();
    expect(autocompleteMenu()).toBeNull();

    // 3. Fence isolation: compute ```query body line dynamically after {Enter} shifted lines
    const queryBodyLine = findFenceBodyLine(view, '```query');
    expect(view.state.doc.line(queryBodyLine - 1).text.trim()).toBe('```query');
    openBodyLine(queryBodyLine, host);
    await userEvent.keyboard('circ');
    await settleCompletion();
    const menuAfterCirc = autocompleteMenu();
    if (menuAfterCirc) {
      const labels = Array.from(menuAfterCirc.querySelectorAll('.cm-completionLabel')).map((l) =>
        l.textContent?.trim(),
      );
      expect(labels).not.toContain('Circuit');
    }

    // Confirm the query body line is genuinely inside the ```query fence and offers :note
    openBodyLine(queryBodyLine, host);
    await userEvent.keyboard(':no');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeVisible();
      expect(firstOptionLabel()?.textContent?.trim()).toBe('note');
    });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(autocompleteMenu()).toBeNull();
    });
  },
};

export const EffortPropertyNoteWithAliases: Story = {
  name: 'Property Note — Effort Aliases, Metrics & Summaries',
  args: {
    initialDoc: THRUSTER_EFFORT_PROPERTY_NOTE,
    mode: 'edit',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('note-editor-host')).toBeVisible();
    await expect(canvas.getAllByText('thrusters').length).toBeGreaterThan(0);
    await expect(canvas.getAllByText('barbell thruster').length).toBeGreaterThan(0);
    await expect(canvas.getAllByText('Weighted Thrusters').length).toBeGreaterThan(0);
  },
};

function FullNoteEditorStorySurface({
  initialDoc,
  withAttentionWidget = false,
  testId = 'full-note-editor-story',
}: {
  initialDoc: string;
  withAttentionWidget?: boolean;
  testId?: string;
}) {
  const [doc, setDoc] = useState(initialDoc);
  const widgetComponents = useMemo<WidgetRegistry | undefined>(
    () =>
      withAttentionWidget
        ? new Map([['attention', createAttentionWidgetWrapper(() => {})]])
        : undefined,
    [withAttentionWidget],
  );
  return (
    <div data-testid={testId} className="max-w-3xl mx-auto p-4">
      <NoteEditor
        value={doc}
        onChange={setDoc}
        enablePreview
        enableLinting
        widgetComponents={widgetComponents}
      />
    </div>
  );
}

function getFullCmView(root: HTMLElement): CodeMirrorTarget & {
  state: CodeMirrorTarget['state'] & { selection: { main: { head: number; anchor: number } } };
  coordsAtPos: (pos: number) => { left: number; top: number } | null;
} {
  const host = root.querySelector('.cm-note-editor') ?? root;
  const view =
    (host as unknown as CmDomHost | null)?.__codemirrorView ??
    (root.querySelector('.cm-editor') as unknown as CmDomHost | null)?.__codemirrorView;
  if (!view) throw new Error('Full NoteEditor view not found');
  return view as CodeMirrorTarget & {
    state: CodeMirrorTarget['state'] & { selection: { main: { head: number; anchor: number } } };
    coordsAtPos: (pos: number) => { left: number; top: number } | null;
  };
}

export const WodFenceEditingAndLinting: Story = {
  name: 'WOD Fence Editing, Frontmatter Hiding & Lint Markers',
  render: () => (
    <FullNoteEditorStorySurface
      testId="wod-fence-edit-story"
      initialDoc={['---', 'title: Just a Movement', 'search: hidden', '---', '', '# Repro', '', '```time', 'Timer: 1:00', '```', ''].join('\n')}
    />
  ),
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-testid="wod-fence-edit-story"]')!;
    await waitFor(() => expect(root.querySelector('.cm-content')).toBeVisible());
    const contentEl = root.querySelector<HTMLElement>('.cm-content')!;
    await userEvent.click(contentEl);
    const view = getFullCmView(root);
    const doc = view.state.doc.toString();
    const pos = doc.indexOf('Timer: 1:00') + 'Timer'.length;
    view.dispatch({ selection: { anchor: pos } });
    view.focus();

    // Frontmatter YAML delimiters stay hidden when caret is in body
    const cmText = contentEl.textContent ?? '';
    expect(cmText.trimStart().startsWith('---')).toBe(false);
    expect(cmText).not.toContain('search: hidden');

    // Type X, Enter, Y inside ```time fence without CM6 crash
    await userEvent.keyboard('X{Enter}Y');
    await waitFor(() => {
      expect(view.state.doc.toString()).toContain('TimerX\nY: 1:00');
    });

    // Broken WOD syntax surfaces lint markers
    const full = view.state.doc.toString();
    view.dispatch({
      changes: { from: 0, to: full.length, insert: '# Bad\n\n```time\n(2\n  5 Burpees\n```\n' },
      selection: { anchor: 0 },
    });
    await waitFor(() => {
      const gutterErr = root.querySelector('.cm-unified-gutter-marker.cm-gutter-error');
      const lintDiag = root.querySelector('.cm-lintPoint-error, .cm-lintRange-error');
      expect(gutterErr || lintDiag).toBeTruthy();
    });
  },
};

export const NoteReferenceMetricsAndPropertyA11y: Story = {
  name: 'Property Preview A11y, Floating Suggestions & Metric Line Panel',
  parameters: {
    domainState: 'populatedJournal',
  },
  render: () => (
    <FullNoteEditorStorySurface
      testId="ref-metrics-a11y-story"
      initialDoc={[
        '---',
        'title: Properties A11y',
        'category:',
        'metrics.effort: kettlebell-swing',
        'metrics.rpe: 7',
        '---',
        '',
        '# Properties',
        '',
        '```time',
        '10 Kettlebell Swings 24kg',
        '```',
        '',
      ].join('\n')}
    />
  ),
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-testid="ref-metrics-a11y-story"]')!;
    await waitFor(() => expect(root.querySelector('.cm-frontmatter-preview')).toBeVisible());
    const view = getFullCmView(root);
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('# Properties') } });

    const showDetails = await within(root).findByRole('button', { name: 'Show property details' });
    await userEvent.click(showDetails);

    await waitFor(() => {
      const preview = root.querySelector<HTMLElement>('.cm-frontmatter-preview');
      expect(preview?.querySelector('[data-frontmatter-column="key"]')?.textContent).toBe('Key');
      expect(preview?.querySelector('[data-frontmatter-column="value"]')?.textContent).toBe('Value');
    });

    const preview = root.querySelector<HTMLElement>('.cm-frontmatter-preview')!;
    const catInput = preview.querySelector<HTMLInputElement>(
      '[data-frontmatter-row="category"] input[aria-label="Value for category"]',
    )!;
    expect(catInput).toBeVisible();
    expect(catInput.getAttribute('aria-haspopup')).toBe('listbox');
    expect(catInput.getAttribute('role')).toBe('combobox');

    const panelHeightBefore = preview.getBoundingClientRect().height;
    await userEvent.click(catInput);
    const listId = catInput.getAttribute('aria-controls');
    expect(listId).toBeTruthy();

    await waitFor(() => {
      const list = document.getElementById(listId!);
      expect(list).toBeVisible();
      expect(list?.getAttribute('aria-label')).toBe('Suggested tags');
      expect(list?.closest('.cm-frontmatter-preview')).toBeNull();
      expect(list!.getBoundingClientRect().width).toBeLessThanOrEqual(340);
    });
    expect(Math.abs(preview.getBoundingClientRect().height - panelHeightBefore)).toBeLessThanOrEqual(1);
    await userEvent.keyboard('{Escape}');

    // Focusing workout line renders the live inline metric panel
    const swingOffset = view.state.doc.toString().indexOf('Kettlebell Swings');
    view.dispatch({ selection: { anchor: swingOffset } });
    view.focus();
    await waitFor(() => {
      expect(root.querySelector('[aria-label="Metric inline panel"]')).toBeVisible();
    });
  },
};

export const NoteEditorVisualNavigation: Story = {
  name: 'Visual Row Caret Navigation across Wrapped Prose & Fences',
  render: () => {
    const paragraph =
      'This deliberately long paragraph line exists to soft wrap across several ' +
      'visual rows inside the note editor viewport, so that vertical caret ' +
      'navigation traverses one visual row at a time instead of jumping between ' +
      'logical document lines when the caret climbs or descends through it.';
    const doc = [
      '---',
      'title: Nav Regression',
      '---',
      '',
      '# Navigation regression',
      '',
      paragraph,
      '',
      '```time',
      'Timer: 1:00',
      '10 Burpees',
      '',
      '10 Push Ups',
      '```',
    ].join('\n');
    return <FullNoteEditorStorySurface testId="visual-nav-story" initialDoc={doc} />;
  },
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-testid="visual-nav-story"]')!;
    await waitFor(() => expect(root.querySelector('.cm-content')).toBeVisible());
    await userEvent.click(root.querySelector<HTMLElement>('.cm-content')!);
    const view = getFullCmView(root);
    const lines = view.state.doc.toString().split('\n');
    const lineStart = (idx: number) => lines.slice(0, idx).reduce((sum, l) => sum + l.length + 1, 0);

    // Start on blank line below wrapped paragraph (index 7) and climb visual rows with ArrowUp
    view.dispatch({ selection: { anchor: lineStart(7) } });
    view.focus();
    let prev = view.coordsAtPos(lineStart(7))!;
    expect(prev).not.toBeNull();
    let climbedInsidePara = 0;
    for (let i = 0; i < 10; i++) {
      await userEvent.keyboard('{ArrowUp}');
      const head = view.state.selection.main.head;
      if (head === lineStart(6)) break;
      expect(head).toBeGreaterThan(lineStart(6));
      const next = view.coordsAtPos(head)!;
      expect(next.top).toBeLessThan(prev.top);
      expect(prev.top - next.top).toBeLessThanOrEqual(30);
      prev = next;
      climbedInsidePara++;
    }
    expect(climbedInsidePara).toBeGreaterThanOrEqual(1);
    expect(view.state.selection.main.head).toBe(lineStart(6));

    // Shift+ArrowUp extends selection one line up
    view.dispatch({ selection: { anchor: lineStart(12) } });
    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}');
    expect(view.state.selection.main.anchor).toBe(lineStart(12));
    expect(view.state.selection.main.head).toBe(lineStart(11));

    // Home on empty line is a no-op
    view.dispatch({ selection: { anchor: lineStart(11) } });
    await userEvent.keyboard('{Home}');
    expect(view.state.selection.main.head).toBe(lineStart(11));
  },
};

export const WidgetBlockEditAndErrorInlay: Story = {
  name: 'Widget Block Inline Edit, Blur Save, Error Inlay & Keyboard Flow',
  render: () => {
    const config = JSON.stringify({
      headline: 'Widget Edit Seed',
      subtitle: 'Seeded attention widget for Storybook.',
      pillars: [{ icon: '✍️', label: 'Markdown', description: 'Seed pillar.' }],
      actions: [],
    });
    return (
      <FullNoteEditorStorySurface
        testId="widget-edit-story"
        withAttentionWidget
        initialDoc={`# Widget Edit Story\n\n\`\`\`widget:attention\n${config}\n\`\`\`\n`}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-testid="widget-edit-story"]')!;
    await waitFor(() => expect(root.querySelector('[data-testid="widget-preview-surface"]')).toBeVisible());

    const moveCursorOut = async () => {
      const heading = within(root).getByText(/Widget Edit Story/);
      await userEvent.click(heading);
    };

    const mkConfig = (headline: string) =>
      JSON.stringify({
        headline,
        subtitle: 'Seeded attention widget for Storybook.',
        pillars: [{ icon: '✍️', label: 'Markdown', description: 'Seed pillar.' }],
        actions: [],
      });

    const setNativeTextareaValue = (ta: HTMLTextAreaElement, val: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(ta, val);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    };

    // 1. Focus preview surface -> wait for Edit button -> click Edit -> Save -> preview updates
    const surface = root.querySelector<HTMLElement>('[data-testid="widget-preview-surface"]')!;
    surface.focus();
    const editBtn = await waitFor(() => {
      const btn = root.querySelector<HTMLElement>('[aria-label="Edit widget"]');
      expect(btn).toBeVisible();
      return btn!;
    });
    await userEvent.click(editBtn);

    const textarea = await waitFor(() => {
      const el = root.querySelector<HTMLTextAreaElement>('[data-testid="widget-markdown-editor"]');
      expect(el).toBeVisible();
      expect(document.activeElement).toBe(el);
      return el!;
    });
    setNativeTextareaValue(textarea, mkConfig('Updated'));
    await userEvent.click(root.querySelector<HTMLElement>('[aria-label="Save widget"]')!);
    await moveCursorOut();

    await waitFor(() => {
      expect(root.querySelector('[data-testid="widget-markdown-editor"]')).toBeNull();
      expect(root.querySelector('[data-testid="widget-preview-surface"]')?.textContent).toContain('Updated');
    });

    // 1b. Auto-saves valid JSON on blur without clicking Save or pressing Ctrl+Enter
    const surfaceBlur = root.querySelector<HTMLElement>('[data-testid="widget-preview-surface"]')!;
    surfaceBlur.focus();
    const editBtnBlur = await waitFor(() => {
      const btn = root.querySelector<HTMLElement>('[aria-label="Edit widget"]');
      expect(btn).toBeVisible();
      return btn!;
    });
    await userEvent.click(editBtnBlur);

    const blurTa = await waitFor(() => {
      const el = root.querySelector<HTMLTextAreaElement>('[data-testid="widget-markdown-editor"]');
      expect(el).toBeVisible();
      expect(document.activeElement).toBe(el);
      return el!;
    });
    setNativeTextareaValue(blurTa, mkConfig('BlurSaved'));
    await moveCursorOut();

    await waitFor(() => {
      expect(root.querySelector('[data-testid="widget-markdown-editor"]')).toBeNull();
      expect(root.querySelector('[data-testid="widget-preview-surface"]')?.textContent).toContain('BlurSaved');
    });

    // 2. Invalid JSON blur shows widget-error-inlay and Undo restores preview
    const surface2 = root.querySelector<HTMLElement>('[data-testid="widget-preview-surface"]')!;
    surface2.focus();
    const editBtn2 = await waitFor(() => {
      const btn = root.querySelector<HTMLElement>('[aria-label="Edit widget"]');
      expect(btn).toBeVisible();
      return btn!;
    });
    await userEvent.click(editBtn2);
    const invalidTa = await waitFor(() => {
      const el = root.querySelector<HTMLTextAreaElement>('[data-testid="widget-markdown-editor"]');
      expect(el).toBeVisible();
      expect(document.activeElement).toBe(el);
      return el!;
    });
    setNativeTextareaValue(invalidTa, '{"title":');
    await moveCursorOut();

    await waitFor(() => {
      expect(root.querySelector('[data-testid="widget-error-inlay"]')).toBeVisible();
    });
    const undoBtn = root.querySelector<HTMLElement>('[aria-label="Undo changes"]')!;
    await userEvent.click(undoBtn);
    await waitFor(() => {
      expect(root.querySelector('[data-testid="widget-error-inlay"]')).toBeNull();
      expect(root.querySelector('[data-testid="widget-markdown-editor"]')).toBeNull();
    });

    // 3. Keyboard flow: Enter to edit, Escape to discard, Ctrl+Enter to save
    const surfaceAfter = root.querySelector<HTMLElement>('[data-testid="widget-preview-surface"]')!;
    surfaceAfter.focus();
    await userEvent.keyboard('{Enter}');
    const kbTa = await waitFor(() => {
      const el = root.querySelector<HTMLTextAreaElement>('[data-testid="widget-markdown-editor"]');
      expect(el).toBeVisible();
      return el!;
    });
    setNativeTextareaValue(kbTa, mkConfig('Discarded'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(root.querySelector('[data-testid="widget-markdown-editor"]')).toBeNull();
      expect(root.querySelector('[data-testid="widget-preview-surface"]')?.textContent).not.toContain('Discarded');
    });

    const surface3 = root.querySelector<HTMLElement>('[data-testid="widget-preview-surface"]')!;
    surface3.focus();
    await userEvent.keyboard('{Enter}');
    const kbTa2 = await waitFor(() => {
      const el = root.querySelector<HTMLTextAreaElement>('[data-testid="widget-markdown-editor"]');
      expect(el).toBeVisible();
      return el!;
    });
    setNativeTextareaValue(kbTa2, mkConfig('CtrlSaved'));
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await moveCursorOut();
    await waitFor(() => {
      expect(root.querySelector('[data-testid="widget-preview-surface"]')?.textContent).toContain('CtrlSaved');
    });
  },
};
