import { blockContentId } from '../models/blockContentId';
import type { NoteBlock } from '../types/storage';
import type { FrontMatterSubtype, Section } from '../types/section';

export { blockContentId };
export const KNOWN_SECTION_WIDGETS: readonly string[] = ['playground-run-tip', 'attention', 'code-example', 'syntax-group'];

export function matchDialectFence(trimmedLine: string): { dialect: 'time' | 'log'; sport?: string } | null {
  const match = trimmedLine.match(/^`{3,}(time|log)(?::([\w-]+))?\s*$/i);
  if (!match) return null;
  return { dialect: match[1].toLowerCase() === 'time' ? 'time' : 'log', ...(match[2] ? { sport: match[2] } : {}) };
}

export interface SectionRecognitionOptions {
  registeredWidgets?: ReadonlySet<string> | readonly string[];
}

export interface ReconcileNoteBlocksOptions extends SectionRecognitionOptions {
  sourceRevision: number;
  /** Current-source occurrence lineage, not a previous document's locations. */
  blocks?: Record<string, NoteBlock>;
  createId?: () => string;
}


function frontmatterSubtype(properties: Record<string, string>): FrontMatterSubtype {
  const type = properties.type?.toLowerCase();
  if (type === 'youtube' || type === 'strava' || type === 'amazon' || type === 'file' || type === 'effort' || type === 'equipment') return type;
  const url = properties.url || properties.link || '';
  const host = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#:]/, 1)[0].toLowerCase();
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'youtube';
  if (host === 'strava.com' || host.endsWith('.strava.com')) return 'strava';
  if (host === 'amzn.to' || host === 'amazon.com' || host.endsWith('.amazon.com')) return 'amazon';
  if (['baseAttributes', 'metrics.met', 'discipline', 'effortType', 'targetRPE', 'equipment', 'aliases', 'derivation'].some(key => key in properties)) return 'effort';
  if (['slug', 'label', 'registrySource', 'ownerNoteId', 'sourcePath'].some(key => key in properties)) return 'equipment';
  return 'default';
}

function markdownSubtype(text: string): string {
  if (/^#{1,6}\s/.test(text)) return 'heading';
  if (/^[-*+]\s|^\d+\.\s/.test(text)) return 'list';
  if (/^>\s?/.test(text)) return 'blockquote';
  if (text.startsWith('|') && /^\|[\s:]*-+/m.test(text)) return 'table';
  return 'paragraph';
}

export function parseDocumentSections(content: string, options: SectionRecognitionOptions = {}): Section[] {
  if (!content) return [];
  const lines = content.split(/\r\n|\n|\r/);
  const offsets: number[] = [];
  const separators: string[] = [];
  let offset = 0;
  for (const text of lines) {
    offsets.push(offset);
    offset += text.length;
    const separator = content.startsWith('\r\n', offset) ? '\r\n' : /[\r\n]/.test(content[offset] ?? '') ? content[offset] : '';
    separators.push(separator);
    offset += separator.length;
  }
  const sections: Section[] = [];
  const createdAt = Date.now();
  let firstText = true;
  let line = 0;

  function make(type: Section['type'], start: number, end: number): Section {
    const from = offsets[start];
    const to = offsets[end] + lines[end].length;
    return {
      id: crypto.randomUUID(), type, from, to,
      rawContent: content.slice(from, to), displayContent: content.slice(from, to),
      startLine: start, endLine: end, lineCount: end - start + 1,
      version: 1, createdAt, separatorAfter: separators[end],
    };
  }

  while (line < lines.length) {
    const text = lines[line].trim();
    const fence = text.match(/^(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const marker = fence[1];
      let close = line + 1;
      const closing = new RegExp(`^${marker[0]}{${marker.length},}\\s*$`);
      while (close < lines.length && !closing.test(lines[close].trim())) close++;
      const closed = close < lines.length;
      const end = closed ? close : lines.length - 1;
      const tag = fence[2].trim();
      const dialect = marker[0] === '`' ? matchDialectFence(`\`\`\`${tag}`) : null;
      const widget = marker[0] === '`' ? tag.match(/^widget:([\w-]+)$/) : null;
      const query = marker[0] === '`' ? tag.match(/^query(?:[:\s](.*))?$/i) : null;
      const names = options.registeredWidgets ?? KNOWN_SECTION_WIDGETS;
      const knownWidget = widget && ('has' in names ? names.has(widget[1]) : names.includes(widget[1]));
      const type = closed && dialect ? dialect.dialect : closed && knownWidget ? 'widget' : closed && query ? 'query' : 'code';
      const section = make(type, line, end);
      section.contentFrom = offsets[line] + lines[line].length + separators[line].length;
      section.contentTo = closed ? offsets[close] : section.to;
      section.displayContent = content.slice(section.contentFrom, section.contentTo);
      if (dialect && closed) {
        section.sport = dialect.sport;
        section.contentId = blockContentId(section.displayContent);
        section.scriptBlock = {
          id: section.id, contentId: section.contentId, dialect: dialect.dialect, sport: dialect.sport,
          startLine: line, endLine: end, content: section.displayContent,
          state: 'idle', version: 1, createdAt,
        };
      }
      if (type === 'widget' && widget) section.widgetName = widget[1];
      if (type === 'query' && query) section.querySuffix = (query[1] ?? '').trim();
      sections.push(section);
      line = end + 1;
      continue;
    }
    if (text === '---' && lines[line + 1]?.trim()) {
      let close = line + 1;
      while (close < lines.length && lines[close].trim() !== '---' && !/^(`{3,}|~{3,})/.test(lines[close].trim())) close++;
      const inner = lines.slice(line + 1, close);
      if (lines[close]?.trim() === '---' && inner.some(value => /^[A-Za-z_][\w.-]*\s*:/.test(value.trim()))) {
        const section = make('frontmatter', line, close);
        section.contentFrom = offsets[line + 1];
        section.contentTo = offsets[close];
        section.displayContent = content.slice(section.contentFrom, section.contentTo);
        section.properties = {};
        for (const value of inner) {
          const pair = value.match(/^([^:]+):\s*(.*)$/);
          if (pair) section.properties[pair[1].trim()] = pair[2].trim();
        }
        section.frontmatterType = frontmatterSubtype(section.properties);
        sections.push(section);
        line = close + 1;
        continue;
      }
    }
    const embed = text.match(/^(!)?\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)$/);
    if (embed) {
      const section = make('embed', line, line);
      const isImage = !!embed[1];
      section.embed = { type: isImage ? 'image' : /(?:youtube\.com|youtu\.be)/i.test(embed[3]) ? 'youtube' : 'link', label: embed[2], url: embed[3], isImage };
      sections.push(section);
      line++;
      continue;
    }
    let end = line;
    if (text) {
      while (end + 1 < lines.length && lines[end + 1].trim() && !/^(?:`{3,}|~{3,}|---\s*$|!?\[[^\]]*\]\()/.test(lines[end + 1].trim())) end++;
    }
    const section = make(text && firstText ? 'title' : 'markdown', line, end);
    section.subtype = markdownSubtype(section.displayContent.trim());
    if (text) firstText = false;
    sections.push(section);
    line = end + 1;
  }
  return sections;
}

export function actionableSectionKind(section: Section): NoteBlock['kind'] | null {
  if (section.type === 'time' || section.type === 'log') return 'wod';
  if (section.type === 'query' || section.type === 'widget' || section.type === 'embed') return section.type;
  return null;
}

export function reconcileNoteBlocks(rawContent: string, options: ReconcileNoteBlocksOptions): Record<string, NoteBlock> {
  if (!Number.isSafeInteger(options.sourceRevision) || options.sourceRevision < 1) throw new Error('Invalid source revision');
  const result: Record<string, NoteBlock> = Object.create(null);
  const lineage = Object.values(options.blocks ?? {}).filter(block => block && typeof block === 'object');
  const createId = options.createId ?? (() => crypto.randomUUID());
  for (const section of parseDocumentSections(rawContent, options)) {
    const kind = actionableSectionKind(section);
    if (!kind) continue;
    const matches = lineage.filter(block => block.from === section.from && block.to === section.to && block.kind === kind);
    const prior = matches.length === 1 ? matches[0] : undefined;
    const id = prior?.id ?? createId();
    if (!id || Object.hasOwn(result, id)) throw new Error('Duplicate block occurrence ID');
    result[id] = { id, kind, from: section.from, to: section.to, sourceRevision: options.sourceRevision, version: prior?.version ?? 1,
      ...(kind === 'wod' && (section.type === 'time' || section.type === 'log') ? { dialect: section.type, ...(section.sport ? { sport: section.sport } : {}) } : {}),
    };
  }
  return result;
}

export function validateNoteBlocks(rawContent: string, blocks: Record<string, NoteBlock>, sourceRevision: number, options: SectionRecognitionOptions = {}): void {
  if (typeof rawContent !== 'string' || !blocks || typeof blocks !== 'object' || Array.isArray(blocks)) throw new Error('Invalid Note source or blocks');
  for (const [id, block] of Object.entries(blocks)) {
    if (!block || block.id !== id || !id || !Number.isSafeInteger(block.version) || block.version < 1 || block.sourceRevision !== sourceRevision || !Number.isSafeInteger(block.from) || !Number.isSafeInteger(block.to)) throw new Error('Invalid block identity, version or source revision');
  }
  const expected = reconcileNoteBlocks(rawContent, { ...options, sourceRevision, blocks });
  if (Object.keys(expected).length !== Object.keys(blocks).length) throw new Error('Incomplete actionable block map');
  for (const [id, block] of Object.entries(blocks)) {
    const recognized = expected[id];
    if (!recognized || recognized.from !== block.from || recognized.to !== block.to || recognized.kind !== block.kind || recognized.dialect !== block.dialect || recognized.sport !== block.sport) throw new Error('Block does not match authored source');
  }
}

export interface NoteBlockChange { from: number; to: number; insert: string }

export function mapNoteBlockChanges(blocks: Record<string, NoteBlock>, changes: readonly NoteBlockChange[]): Record<string, NoteBlock> {
  let previousEnd = 0;
  for (const change of changes) {
    if (!Number.isSafeInteger(change.from) || !Number.isSafeInteger(change.to) || change.from < previousEnd || change.to < change.from || typeof change.insert !== 'string') throw new Error('Invalid source changes');
    previousEnd = change.to;
  }
  const result: Record<string, NoteBlock> = {};
  for (const block of Object.values(blocks)) {
    let from = block.from;
    let to = block.to;
    let removed = false;
    for (const change of changes) {
      const delta = change.insert.length - (change.to - change.from);
      if (change.from <= block.from && change.to >= block.to || change.from < block.from && change.to > block.from || change.from < block.to && change.to > block.to) { removed = true; break; }
      if (change.to <= block.from) { from += delta; to += delta; }
      else if (change.from < block.to) to += delta;
    }
    if (!removed) result[block.id] = { ...block, from, to };
  }
  return result;
}

export function buildRawContent(sections: Section[]): string {
  return sections.filter(section => !section.deleted).map(section => section.rawContent + (section.separatorAfter ?? '')).join('');
}

export function calculateTotalLines(sections: Section[]): number {
  const visible = sections.filter(section => !section.deleted);
  return visible.length ? visible[visible.length - 1].endLine + 1 : 0;
}
