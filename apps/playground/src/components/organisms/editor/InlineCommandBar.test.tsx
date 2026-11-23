import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { sectionField, sectionGeometry } from '@bitcobblers/wod-wiki-ui/extensions';
import { Copy, ExternalLink, Play } from 'lucide-react';
import { InlineCommandBar } from './InlineCommandBar';
import type { ScriptCommand } from '@/components/Editor/overlays/ScriptCommand';
import { TEST_IDS } from '@/lib/testIds';

describe('InlineCommandBar', () => {
  let host: HTMLDivElement | null = null;
  let view: EditorView | null = null;

  afterEach(() => {
    cleanup();
    view?.destroy();
    view = null;
    host?.remove();
    host = null;
  });

  function mountEditorWithBar(commands: ScriptCommand[]) {
    host = document.createElement('div');
    document.body.appendChild(host);
    const state = EditorState.create({
      doc: '```time\n5:00 Run\n```\n',
      extensions: [sectionField, sectionGeometry],
    });
    view = new EditorView({ state, parent: host });
    return render(<InlineCommandBar view={view} commands={commands} />);
  }

  it('renders height-matched header buttons and split Copy link control without oversized sm:min-h-[44px]', () => {
    const onRun = vi.fn();
    const onPlayground = vi.fn();
    const onCopy = vi.fn();

    mountEditorWithBar([
      {
        id: 'run',
        label: 'Run',
        icon: <Play className="size-3.5 fill-current" />,
        primary: true,
        onClick: onRun,
      },
      {
        id: 'playground',
        label: 'Playground',
        icon: <ExternalLink className="size-3.5" />,
        splitIcon: <Copy className="size-3.5" />,
        onClick: onPlayground,
        onSplitClick: onCopy,
      },
    ]);

    const runBtn = screen.getByTestId(TEST_IDS.EDITOR_START_WORKOUT);
    expect(runBtn.className).toContain('h-7');
    expect(runBtn.className).toContain('max-lg:min-h-[44px]');
    expect(runBtn.className).toContain('bg-primary');

    const playgroundBtn = screen.getByRole('button', { name: 'Playground' });
    const copyBtn = screen.getByRole('button', { name: 'Copy link' });
    expect(playgroundBtn.className).toContain('h-7');
    expect(playgroundBtn.className).toContain('max-lg:min-h-[44px]');
    expect(playgroundBtn.className).not.toContain('sm:min-h-[44px]');
    expect(copyBtn.className).toContain('h-7');
    expect(copyBtn.className).toContain('max-lg:min-h-[44px]');

    fireEvent.click(runBtn);
    fireEvent.click(playgroundBtn);
    fireEvent.click(copyBtn);

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onPlayground).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
