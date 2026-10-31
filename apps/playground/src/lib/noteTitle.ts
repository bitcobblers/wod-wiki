/**
 * Note title display helpers.
 *
 * These are display-level normalizations only; they do not rewrite stored
 * titles. They strip accidental Markdown heading markers that leak into UI
 * labels from raw content.
 */

const MARKDOWN_HEADING_RE = /^#{1,6}\s+/;

/**
 * Strip leading Markdown heading markers (e.g. `# Welcome workout` →
 * `Welcome workout`) and trim whitespace. Returns an empty string for
 * blank/whitespace-only titles so callers can render a placeholder.
 */
export function normalizeNoteTitle(title: string | undefined | null): string {
    return (title ?? '').replace(MARKDOWN_HEADING_RE, '').trim();
}

/** Extract the first H1 markdown heading title from raw note content. */
export function extractHeadingTitle(rawContent: string): string | undefined {
    const match = rawContent.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : undefined;
}
