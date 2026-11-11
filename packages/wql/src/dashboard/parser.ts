import { parseFrontmatter } from './frontmatter';
import { parseQueryWidgetSuffix, isDashboardWidgetType, type DashboardSectionInput, type DashboardMeta } from './model';

export interface DashboardParsedSection extends DashboardSectionInput {
  /** 0-indexed start line of the section in the raw content. */
  startLine: number;
  /** 0-indexed inclusive end line of the section in the raw content. */
  endLine: number;
}

/**
 * Parses a raw markdown note into sections suitable for `buildDashboardDocument`,
 * keeping track of line numbers so edits can write back to the source text.
 */
export function parseDashboardNote(rawContent: string): { meta: DashboardMeta; sections: DashboardParsedSection[] } {
  const { meta } = parseFrontmatter(rawContent);
  const lines = rawContent.split(/\r?\n/);
  const sections: DashboardParsedSection[] = [];

  // Find where the body starts (skip frontmatter)
  let i = 0;
  if (lines.length > 0 && lines[0].trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') {
      i++;
    }
    i++; // skip the closing ---
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Query block
    const isQueryFence = /^```query(?:[:\s]|$)/i.test(trimmed);
    const widgetFenceMatch = !isQueryFence ? trimmed.match(/^```widget:([a-zA-Z0-9_-]+.*)?$/i) : null;
    const isWidgetChartFence = Boolean(
      widgetFenceMatch && widgetFenceMatch[1] && isDashboardWidgetType( parseQueryWidgetSuffix(widgetFenceMatch[1]).type ),
    );
    if (isQueryFence || isWidgetChartFence) {
      const tag = trimmed.slice(3);
      let widgetType;
      let spanCols;
      let spanFull;
      let widgetError;
      let attributes: Record<string, string> | undefined;
      let attributeOrder: string[] | undefined;

      const colonMatch = tag.match(/^(?:query|widget):(.*)$/i);
      if (colonMatch) {
        const spec = parseQueryWidgetSuffix(colonMatch[1]);
        widgetType = spec.type || undefined;
        spanCols = spec.spanCols;
        spanFull = spec.spanFull;
        widgetError = spec.error;
        attributes = spec.attributes;
        attributeOrder = spec.attributeOrder;
      }
      const startLine = i;
      i++;
      const bodyLines: string[] = [];
      while (i < lines.length && !/^```[\w\d_:-]*$/.test(lines[i].trim())) {
        bodyLines.push(lines[i]);
        i++;
      }
      const endLine = i; // The closing ``` line

      sections.push({
        type: 'query',
        content: bodyLines.join('\n'),
        fenceTag: tag,
        widgetType,
        spanCols,
        spanFull,
        widgetError,
        attributes,
        attributeOrder,
        startLine,
        endLine,
      });
      i++;
      continue;
    }

    // Generic fenced block (non-query code fence, e.g. ```wellness)
    if (/^```[\w\d_:-]*$/.test(trimmed)) {
      const startLine = i;
      const fenceLines: string[] = [lines[i]];
      i++;
      while (i < lines.length && !/^```[\w\d_:-]*$/.test(lines[i].trim())) {
        fenceLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        fenceLines.push(lines[i]);
        i++;
      }
      sections.push({
        type: 'markdown',
        subtype: 'paragraph',
        content: fenceLines.join('\n'),
        startLine,
        endLine: i - 1,
      });
      continue;
    }

    // Heading
    if (trimmed.startsWith('#')) {
      sections.push({
        type: 'markdown',
        subtype: 'heading',
        content: trimmed,
        startLine: i,
        endLine: i,
      });
      i++;
      continue;
    }

    // Paragraph (contiguous non-empty, non-heading, non-fence lines)
    if (trimmed !== '') {
      const startLine = i;
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !lines[i].trim().startsWith('#') &&
        !/^```[\w\d_:-]*$/.test(lines[i].trim())
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      sections.push({
        type: 'markdown',
        subtype: 'paragraph',
        content: paraLines.join('\n'),
        startLine,
        endLine: i - 1,
      });
      continue;
    }

    // Blank lines
    i++;
  }

  return { meta, sections };
}
