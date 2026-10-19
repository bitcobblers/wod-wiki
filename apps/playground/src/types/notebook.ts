/**
 * Notebook Types
 *
 * Every notebook carries a canonical `notebook/{slug}` identifier
 * (including the predefined default notebooks `notebook/journal`,
 * `notebook/playground`, and `notebook/guides`).
 *
 * Read-only / editability is decided at the application level via
 * `isNoteEditable` (only user-created notes `seedOrigin !== 'seed'` are editable).
 */
import {
    DEFAULT_NOTEBOOK_SLUGS,
    isNoteEditable,
    notebookSlugFromId,
    toNotebookId,
    type DefaultNotebookSlug,
    type Notebook,
    type NotebookId,
    type NotebookOrigin,
} from '@bitcobblers/wod-wiki-core';

export {
    DEFAULT_NOTEBOOK_SLUGS,
    isNoteEditable,
    notebookSlugFromId,
    toNotebookId,
    type DefaultNotebookSlug,
    type Notebook,
    type NotebookId,
    type NotebookOrigin,
};

/** Slugify a human notebook name into a lowercase hyphenated slug. */
export function slugifyNotebookName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'notebook';
}

/** The tag prefix used to associate entries with notebooks */
export const NOTEBOOK_TAG_PREFIX = 'notebook:';

/** Build a tag string for a given notebook ID */
export const toNotebookTag = (notebookId: string): string =>
    `${NOTEBOOK_TAG_PREFIX}${notebookId}`;

/** Extract notebook ID from a tag string, or null if not a notebook tag */
export const fromNotebookTag = (tag: string): string | null =>
    tag.startsWith(NOTEBOOK_TAG_PREFIX) ? tag.slice(NOTEBOOK_TAG_PREFIX.length) : null;

/** Check if a tag is a notebook tag */
export const isNotebookTag = (tag: string): boolean =>
    tag.startsWith(NOTEBOOK_TAG_PREFIX);
