/**
 * catalogueReload — the editor's signal that a reference catalogue changed.
 *
 * The editor resolves `#slug` references and equipment aliases against
 * catalogues that live in async storage: the tag catalogue, the effort
 * registry, the equipment registry. They hydrate after the editor is already
 * on screen, so the marks the editor draws (a tag reference as a hashtag, an
 * equipment word as equipment) would be missing until the next keystroke.
 *
 * This effect is the push those catalogues need: whoever changes a catalogue
 * dispatches it, and the editor redraws its marks.
 */

import { StateEffect, type Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { subscribeTagIndex } from '@/services/tags/tagCatalogue';
import { subscribeAppEffortRegistry } from '@/services/effortRegistry';
import { subscribeAppEquipmentRegistry } from '@/services/equipmentRegistry';

/** Dispatched when a reference catalogue changed and the editor must redraw. */
export const catalogueReload = StateEffect.define<null>();

/**
 * Redraw the editor's marks when a catalogue changes.
 *
 * The plugin listens to the tag catalogue and to the effort and equipment
 * registries, and dispatches {@link catalogueReload} for each change.
 */
export const catalogueReloadPlugin: Extension = ViewPlugin.fromClass(
    class {
        private readonly unsubscribes: Array<() => void>;

        constructor(view: EditorView) {
            const reload = () => view.dispatch({ effects: [catalogueReload.of(null)] });
            this.unsubscribes = [
                subscribeTagIndex(reload),
                subscribeAppEffortRegistry(reload),
                subscribeAppEquipmentRegistry(reload),
            ];
        }

        update(_update: ViewUpdate): void {
            // The catalogues push their own changes; nothing to do per update.
        }

        destroy(): void {
            for (const unsubscribe of this.unsubscribes) unsubscribe();
        }
    },
);
