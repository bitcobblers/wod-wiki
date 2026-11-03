import { useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Edit3 } from 'lucide-react';
import { EditorDialog } from '@bitcobblers/wod-wiki-ui';
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
  ':journal{effort:snatch} last 4w | :sum{metric:tis} | :bar{}',
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

const meta: Meta<NoteEditorStoryArgs> = {
  id: 'screens',
  title: 'Playground/Organisms/Editor/NoteEditor',
  component: UniversalNoteEditorHarness,
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
  },
};

export const UniversalNoteEditorDialog: Story = {
  name: 'Universal Note Editor Dialog',
  render: (args) => <NoteEditorDialogHarness initialDoc={args.initialDoc} />,
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
