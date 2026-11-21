import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { EditorView } from '@codemirror/view';
import {
  CompletionContext,
  acceptCompletion,
  completionStatus,
  currentCompletions,
  setSelectedCompletion,
  startCompletion,
} from '@codemirror/autocomplete';
import { NoteEditor } from '@/components/organisms/editor/NoteEditor';
import { wodCompletionSource, sectionField, setQuerySourceEditing } from '@bitcobblers/wod-wiki-ui/extensions';
import { createInlineTagFromSlug } from '@/app/editor/noteEditorServices';
import {
  getAppEffortRegistry,
  hydrateAppEffortRegistry,
  resetAppEffortRegistryForTesting,
} from '@/services/effortRegistry';
import {
  getAppEquipmentRegistry,
  hydrateAppEquipmentRegistry,
  resetAppEquipmentRegistryForTesting,
} from '@/services/equipmentRegistry';
import { InMemoryStorage, resetStorageForTesting, setStorageForTesting } from '@/hooks/useBrowserServices';

const zeroRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
Object.defineProperty(window.Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => zeroRect });

beforeEach(() => {
  setStorageForTesting(new InMemoryStorage());
});

afterEach(() => {
  cleanup();
  resetStorageForTesting();
  resetAppEffortRegistryForTesting();
  resetAppEquipmentRegistryForTesting();
});

function editor(doc: string, cursor: number) {
  let createdView: EditorView | undefined;
  render(<NoteEditor value={doc} onChange={() => {}} enablePreview={false} enableLinting={false}
    hideDefaultCommands onViewCreated={(view) => { createdView = view; }} />);
  if (!createdView) throw new Error('Editor did not mount');
  const view = createdView;
  act(() => {
    view.dispatch({ selection: { anchor: cursor } });
    view.focus();
  });
  return view;
}

function labels(view: EditorView): string[] {
  return currentCompletions(view.state).map((option) => option.label);
}

describe('NoteEditor nested completion', () => {
  it('completes query fence bodies with the standalone WQL vocabulary when source editing is active', async () => {
    const doc = '```query\nfind session{metric:re\n```';
    const pos = doc.indexOf('{metric:re') + '{metric:re'.length;
    const view = editor(doc, pos);
    const querySection = view.state.field(sectionField).sections.find((s) => s.type === 'query');
    expect(querySection).toBeDefined();

    // Collapsed preview blocks suppress floating typeahead until source editing begins.
    act(() => { startCompletion(view); });
    await waitFor(() => expect(completionStatus(view.state)).toBeNull());
    expect(labels(view)).toEqual([]);

    // Entering query source edit mode enables full nested WQL completion.
    act(() => {
      view.dispatch({
        selection: { anchor: pos },
        effects: setQuerySourceEditing.of({ sectionId: querySection!.id, editing: true }),
      });
      startCompletion(view);
    });
    await waitFor(() => expect(labels(view)).toContain('reps'));
    // Opening-fence suggestions never leak into the code body.
    expect(labels(view).every((label) => !label.startsWith('```'))).toBe(true);
  });

  it('keeps markdown prose free of options and gives time bodies Whiteboard Script only', async () => {
    const prose = editor('# Note\n\nSome prose\n', '# Note\n\nSome prose\n'.length);
    act(() => { startCompletion(prose); });
    await waitFor(() => expect(completionStatus(prose.state)).toBeNull());
    expect(labels(prose)).toEqual([]);

    // Async sources resolve in this harness too, but with a small timer hop —
    // the live path is covered below. This direct invocation of the editor's
    // own provider chain additionally pins the contract: same state, same
    // facet wiring, first result wins.
    const time = editor('```time\n10:00 \n```', '```time\n10:00 '.length);
    const result = await wodCompletionSource(
      new CompletionContext(time.state, time.state.selection.main.head, true),
    );
    const timeLabels = result?.options.map((option) => option.label) ?? [];
    // Grammar-aware Whiteboard Script suggestions — no WQL, no opening fences.
    expect(timeLabels).toContain('FOR TIME');
    expect(timeLabels.every((label) => !label.startsWith('```'))).toBe(true);
    expect(timeLabels).not.toContain('reps');
  });

  it('offers time-body vocabulary live through startCompletion', async () => {
    const doc = '```time\n10:00 \n```';
    const view = editor(doc, '```time\n10:00 '.length);
    act(() => { startCompletion(view); });
    await waitFor(() => expect(labels(view)).toContain('FOR TIME'));
    // Whiteboard Script only — no WQL, no opening-fence suggestions.
    expect(labels(view)).not.toContain('reps');
    expect(labels(view).every((label) => !label.startsWith('```'))).toBe(true);
  });

  it('triggers tag completion on bare # and transitions from glued number units to post-space missing elements', async () => {
    await createInlineTagFromSlug('heavy');
    await hydrateAppEffortRegistry(getAppEffortRegistry());
    await hydrateAppEquipmentRegistry(getAppEquipmentRegistry());
    await getAppEffortRegistry().upsert({
      id: 'eff-bs',
      slug: 'back-squat',
      label: 'Back Squat',
      aliases: [],
      baseAttributes: { met: 6 },
      registrySource: 'user',
    });

    const tagDoc = '```time\n20 #\n```';
    const tagView = editor(tagDoc, tagDoc.indexOf('#') + 1);
    act(() => { startCompletion(tagView); });
    await waitFor(() => expect(labels(tagView)).toContain('heavy'));

    const gluedDoc = '```time\n20\n```';
    const gluedView = editor(gluedDoc, gluedDoc.indexOf('20') + 2);
    act(() => { startCompletion(gluedView); });
    await waitFor(() => expect(labels(gluedView)).toContain('kg'));
    const gluedOpts = labels(gluedView);
    expect(gluedOpts).toContain('reps');
    expect(gluedOpts).toContain('rounds');
    expect(gluedOpts).not.toContain('AMRAP');
    expect(gluedOpts).not.toContain('EMOM');

    const spacedDoc = '```time\n20 \n```';
    const spacedView = editor(spacedDoc, spacedDoc.indexOf('20 ') + 3);
    act(() => { startCompletion(spacedView); });
    await waitFor(() => expect(labels(spacedView)).toContain('Back Squat'));
    const spacedOpts = labels(spacedView);
    expect(spacedOpts).not.toContain('kg');
    expect(spacedOpts).not.toContain('reps');
    expect(spacedOpts).not.toContain('rounds');
  });

  it('applies coordinate-invariant compositional suffix and live effort upgrades inside nested fences', async () => {
    await hydrateAppEffortRegistry(getAppEffortRegistry());
    await hydrateAppEquipmentRegistry(getAppEquipmentRegistry());
    await getAppEffortRegistry().upsert({
      id: 'eff-snatch',
      slug: 'snatch',
      label: 'Snatch',
      aliases: [],
      equipment: ['dumbbell'],
      baseAttributes: { met: 9 },
      registrySource: 'user',
    });
    await getAppEffortRegistry().upsert({
      id: 'eff-kb-snatch',
      slug: 'kettlebell-snatch',
      label: 'Kettlebell Snatch',
      aliases: ['kb snatch'],
      equipment: ['kettlebell'],
      baseAttributes: { met: 9.5 },
      registrySource: 'user',
    });
    await getAppEffortRegistry().upsert({
      id: 'eff-walk',
      slug: 'walking-3-mph',
      label: 'Walking',
      aliases: ['walk'],
      baseAttributes: { met: 3.5 },
      registrySource: 'user',
    });
    await getAppEquipmentRegistry().upsert({
      id: 'eq-kb',
      slug: 'kettlebell',
      label: 'Kettlebell',
      aliases: ['kb'],
      registrySource: 'user',
    });
    await getAppEquipmentRegistry().upsert({
      id: 'eq-vest',
      slug: 'weight-vest',
      label: 'Weight Vest',
      aliases: ['vest'],
      registrySource: 'user',
    });

    const acceptInNested = async (doc: string, needle: string, optionLabel: string): Promise<string> => {
      const view = editor(doc, doc.indexOf(needle) + needle.length);
      act(() => { startCompletion(view); });
      await waitFor(() => expect(labels(view)).toContain(optionLabel));
      const idx = currentCompletions(view.state).findIndex((option) => option.label === optionLabel);
      act(() => {
        view.dispatch({ effects: setSelectedCompletion(idx) });
        acceptCompletion(view);
      });
      return view.state.doc.toString();
    };

    expect(await acceptInNested('```time\n10 Snatch KB\n```', '10 Snatch KB', 'Kettlebell')).toBe(
      '```time\n10 Snatch Kettlebell\n```',
    );
    expect(await acceptInNested('```time\n10 Snatch KB\n```', '10 Snatch KB', 'Kettlebell Snatch')).toBe(
      '```time\n10 Kettlebell Snatch\n```',
    );
    expect(await acceptInNested('```time\n10 Walking weight v\n```', '10 Walking weight v', 'Weight Vest')).toBe(
      '```time\n10 Walking Weight Vest\n```',
    );
  });
});
