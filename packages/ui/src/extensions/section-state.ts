import {
  blockContentId,
  actionableSectionKind,
  mapNoteBlockChanges,
  parseDocumentSections,
  reconcileNoteBlocks,
  validateNoteBlocks,
  type NoteBlock,
  type Section,
} from '@bitcobblers/wod-wiki-core';
import { Facet, StateField, StateEffect, EditorState } from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';
import { parseQueryWidgetSuffix } from '@bitcobblers/wod-wiki-wql';

export type EditorDialect = 'time' | 'log';
export type EditorSectionType = Exclude<Section['type'], 'title'>;
export type EditorSectionSubtype = 'heading' | 'paragraph' | 'list' | 'blockquote' | 'table' | 'unknown';
export type EmbedType = 'image' | 'link' | 'youtube';

export interface EditorSection {
  id: string;
  type: EditorSectionType;
  subtype?: EditorSectionSubtype;
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  contentFrom?: number;
  contentTo?: number;
  sport?: string;
  widgetName?: string;
  contentId?: string;
  queryType?: string;
  queryError?: string;
  embed?: { type: EmbedType; url: string; label: string; videoId?: string; height?: number };
}

export interface SectionIdentity {
  blocks: Record<string, NoteBlock>;
  sourceRevision: number;
  rawContent?: string;
}

export interface SectionState {
  sections: EditorSection[];
  rawContent: string;
  sourceRevision: number;
  noteBlocks: Record<string, NoteBlock>;
  savedVersions: Record<string, number>;
}

export const sectionIdentity = Facet.define<SectionIdentity, SectionIdentity | undefined>({ combine: values => values[0] });
export const registeredSectionWidgets = Facet.define<readonly string[], readonly string[] | undefined>({ combine: values => values.length ? values.flat() : undefined });
export const forceSectionParse = StateEffect.define<null>();
export const sectionSaved = StateEffect.define<SectionIdentity>();
export const sectionRestore = StateEffect.define<SectionIdentity & { rawContent: string }>();
/** Destination offsets refer to the new CodeMirror document. Only explicit moves retain an ID. */
export const sectionMove = StateEffect.define<{ id: string; from: number; to: number }>();
export { blockContentId };

interface HistoryIdentity {
  rawContent: string;
  blocks: Record<string, NoteBlock>;
}
const restoreHistoryIdentity = StateEffect.define<HistoryIdentity>({
  map(value, changes) {
    const blocks: Record<string, NoteBlock> = {};
    for (const block of Object.values(value.blocks)) {
      const from = changes.mapPos(block.from, 1);
      const to = changes.mapPos(block.to, -1);
      if (from < to) blocks[block.id] = { ...block, from, to };
    }
    return { rawContent: value.rawContent, blocks };
  },
});

function sourceCoordinates(rawContent: string): { rawStarts: number[]; editorStarts: number[] } {
  const rawStarts = [0];
  const editorStarts = [0];
  let removed = 0;
  for (const match of rawContent.matchAll(/\r\n|\r|\n/g)) {
    removed += match[0].length - 1;
    rawStarts.push(match.index + match[0].length);
    editorStarts.push(match.index + match[0].length - removed);
  }
  return { rawStarts, editorStarts };
}

function toSourcePosition(state: EditorState, rawStarts: number[], position: number): number {
  const line = state.doc.lineAt(position);
  return rawStarts[line.number - 1] + position - line.from;
}

function toEditorBlocks(state: SectionState): Record<string, NoteBlock> {
  const blocks: Record<string, NoteBlock> = {};
  for (const block of Object.values(state.noteBlocks)) {
    const section = state.sections.find(section => section.id === block.id);
    if (section) blocks[block.id] = { ...block, from: section.from, to: section.to };
  }
  return blocks;
}

function deriveState(state: EditorState, rawContent: string, sourceRevision: number, lineage: Record<string, NoteBlock>, savedVersions: Record<string, number>, previousSections: EditorSection[] = []): SectionState {
  const registeredWidgets = state.facet(registeredSectionWidgets);
  const noteBlocks = reconcileNoteBlocks(rawContent, { sourceRevision, blocks: lineage, registeredWidgets });
  const coordinates = sourceCoordinates(rawContent);
  const sections = parseDocumentSections(rawContent, { registeredWidgets }).map((section): EditorSection => {
    const start = coordinates.editorStarts[section.startLine];
    const end = coordinates.editorStarts[section.endLine] + section.to - coordinates.rawStarts[section.endLine];
    const block = actionableSectionKind(section) ? Object.values(noteBlocks).find(block => block.from === section.from && block.to === section.to) : undefined;
    const prior = previousSections.find(prior => prior.from === start && prior.to === end && prior.type === (section.type === 'title' ? 'markdown' : section.type));
    const query = section.querySuffix ? parseQueryWidgetSuffix(section.querySuffix) : undefined;
    const subtype = section.subtype;
    return {
      id: block?.id ?? prior?.id ?? section.id,
      type: section.type === 'title' ? 'markdown' : section.type,
      ...(subtype === 'heading' || subtype === 'paragraph' || subtype === 'list' || subtype === 'blockquote' || subtype === 'table' ? { subtype } : {}),
      from: start, to: end, startLine: section.startLine + 1, endLine: section.endLine + 1,
      ...(section.contentFrom !== undefined ? { contentFrom: coordinates.editorStarts[section.startLine + 1] ?? end } : {}),
      ...(section.contentTo !== undefined ? { contentTo: coordinates.editorStarts[section.endLine] - (section.type === 'frontmatter' ? 1 : 0) } : {}),
      sport: section.sport, widgetName: section.widgetName, contentId: section.contentId,
      queryType: query?.type, queryError: query?.error, embed: section.embed,
    };
  });
  for (const block of Object.values(noteBlocks)) block.version = savedVersions[block.id] ?? block.version;
  return { sections, rawContent, sourceRevision, noteBlocks, savedVersions };
}

export const sectionField = StateField.define<SectionState>({
  create(state) {
    const initial = state.facet(sectionIdentity);
    const rawContent = initial?.rawContent ?? state.doc.toString();
    if (rawContent.replace(/\r\n|\r/g, '\n') !== state.doc.toString()) throw new Error('Editor source and identity map disagree');
    if (initial) validateNoteBlocks(rawContent, initial.blocks, initial.sourceRevision, { registeredWidgets: state.facet(registeredSectionWidgets) });
    const savedVersions = Object.fromEntries(Object.values(initial?.blocks ?? {}).map(block => [block.id, block.version]));
    return deriveState(state, rawContent, initial?.sourceRevision ?? 1, initial?.blocks ?? {}, savedVersions);
  },
  update(value, tr) {
    let rawContent = value.rawContent;
    let lineage = value.noteBlocks;
    let sourceRevision = value.sourceRevision;
    let savedVersions = value.savedVersions;
    if (tr.docChanged) {
      const { rawStarts } = sourceCoordinates(rawContent);
      const changes: { from: number; to: number; insert: string }[] = [];
      const lineBreak = rawContent.includes('\r\n') ? '\r\n' : rawContent.includes('\r') ? '\r' : '\n';
      tr.changes.iterChanges((fromA, toA, fromB, toB) => changes.push({
        from: toSourcePosition(tr.startState, rawStarts, fromA),
        to: toSourcePosition(tr.startState, rawStarts, toA),
        insert: tr.newDoc.sliceString(fromB, toB, lineBreak),
      }));
      lineage = mapNoteBlockChanges(lineage, changes);
      for (let i = changes.length - 1; i >= 0; i--) {
        const change = changes[i];
        rawContent = rawContent.slice(0, change.from) + change.insert + rawContent.slice(change.to);
      }
      if (tr.isUserEvent('move.drop')) {
        const moves: { fromA: number; toA: number; fromB: number; toB: number }[] = [];
        tr.changes.iterChanges((fromA, toA, fromB, toB) => moves.push({ fromA, toA, fromB, toB }));
        const deletion = moves.filter(change => change.toA > change.fromA && change.fromB === change.toB);
        const insertion = moves.filter(change => change.fromA === change.toA && change.toB > change.fromB);
        if (deletion.length === 1 && insertion.length === 1) {
          const removed = deletion[0];
          const added = insertion[0];
          if (tr.startState.doc.sliceString(removed.fromA, removed.toA) === tr.newDoc.sliceString(added.fromB, added.toB)) {
            const currentStarts = sourceCoordinates(rawContent).rawStarts;
            for (const section of value.sections) {
              const block = value.noteBlocks[section.id];
              if (block && section.from >= removed.fromA && section.to <= removed.toA) {
                lineage[block.id] = { ...block,
                  from: toSourcePosition(tr.state, currentStarts, added.fromB + section.from - removed.fromA),
                  to: toSourcePosition(tr.state, currentStarts, added.fromB + section.to - removed.fromA),
                };
              }
            }
          }
        }
      }
      if (tr.isUserEvent('move.line')) {
        const currentStarts = sourceCoordinates(rawContent).rawStarts;
        for (let i = 0; i < tr.startState.selection.ranges.length; i++) {
          const before = tr.startState.selection.ranges[i];
          const after = tr.newSelection.ranges[i];
          if (!after) continue;
          const firstLine = tr.startState.doc.lineAt(before.from);
          const lastLine = tr.startState.doc.lineAt(before.to > before.from && tr.startState.doc.lineAt(before.to).from === before.to ? before.to - 1 : before.to);
          const delta = after.anchor - before.anchor;
          for (const section of value.sections) {
            const block = value.noteBlocks[section.id];
            if (block && section.from >= firstLine.from && section.to <= lastLine.to) {
              lineage[block.id] = { ...block,
                from: toSourcePosition(tr.state, currentStarts, section.from + delta),
                to: toSourcePosition(tr.state, currentStarts, section.to + delta),
              };
            }
          }
        }
      }
    }
    for (const effect of tr.effects) {
      if (effect.is(sectionSaved)) {
        sourceRevision = Math.max(sourceRevision, effect.value.sourceRevision);
        savedVersions = { ...savedVersions };
        for (const block of Object.values(effect.value.blocks)) savedVersions[block.id] = Math.max(savedVersions[block.id] ?? 1, block.version);
      }
      if (effect.is(sectionRestore)) {
        if (effect.value.rawContent.replace(/\r\n|\r/g, '\n') !== tr.newDoc.toString()) throw new Error('Restored source does not match editor');
        validateNoteBlocks(effect.value.rawContent, effect.value.blocks, effect.value.sourceRevision, { registeredWidgets: tr.state.facet(registeredSectionWidgets) });
        rawContent = effect.value.rawContent;
        lineage = effect.value.blocks;
        sourceRevision = effect.value.sourceRevision;
        savedVersions = { ...savedVersions, ...Object.fromEntries(Object.values(lineage).map(block => [block.id, block.version])) };
      }
      if (effect.is(restoreHistoryIdentity)) {
        const exactHistory = tr.effects.some(candidate => candidate.is(restoreHistoryIdentity) && candidate.value.rawContent.replace(/\r\n|\r/g, '\n') === tr.newDoc.toString());
        if (exactHistory && effect.value.rawContent.replace(/\r\n|\r/g, '\n') !== tr.newDoc.toString()) continue;
        if (effect.value.rawContent.replace(/\r\n|\r/g, '\n') === tr.newDoc.toString()) rawContent = effect.value.rawContent;
        const { rawStarts } = sourceCoordinates(rawContent);
        lineage = Object.fromEntries(Object.values(effect.value.blocks).map(block => [block.id, {
          ...block, from: toSourcePosition(tr.state, rawStarts, block.from), to: toSourcePosition(tr.state, rawStarts, block.to),
        }]));
      }
      if (effect.is(sectionMove)) {
        const prior = value.noteBlocks[effect.value.id];
        if (!prior || lineage[prior.id]) throw new Error('Explicit move must remove the original occurrence');
        const { rawStarts } = sourceCoordinates(rawContent);
        const from = toSourcePosition(tr.state, rawStarts, effect.value.from);
        const to = toSourcePosition(tr.state, rawStarts, effect.value.to);
        if (rawContent.slice(from, to) !== value.rawContent.slice(prior.from, prior.to)) throw new Error('Explicit move changed source');
        lineage = { ...lineage, [prior.id]: { ...prior, from, to } };
      }
    }
    if (tr.docChanged || tr.effects.some(effect => effect.is(forceSectionParse) || effect.is(sectionRestore) || effect.is(sectionSaved) || effect.is(restoreHistoryIdentity))) {
      const previous = value.sections.map(section => ({ ...section, from: tr.changes.mapPos(section.from, 1), to: tr.changes.mapPos(section.to, -1) }));
      return deriveState(tr.state, rawContent, sourceRevision, lineage, savedVersions, previous);
    }
    return value;
  },
});

export const sectionIdentityHistory = invertedEffects.of(tr => {
  const value = tr.startState.field(sectionField, false);
  return value && tr.docChanged ? [restoreHistoryIdentity.of({ rawContent: value.rawContent, blocks: toEditorBlocks(value) })] : [];
});

export function sectionAtPos(state: EditorState, pos: number): EditorSection | null {
  return state.field(sectionField).sections.find(section => pos >= section.from && pos <= section.to) ?? null;
}

export function activeCursorSection(state: EditorState): EditorSection | null {
  return sectionAtPos(state, state.selection.main.head);
}
