import { autocompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState, Prec, Range, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, placeholder, type DecorationSet, type ViewUpdate } from '@codemirror/view';

import {
  ACTION_CUES,
  WORKOUT_TEMPLATES,
  computeSmartIncrementChange,
  fuzzyMatches,
  scanDocument,
  searchEfforts,
  tokenChipDescriptor,
  type CatalogStore,
  type DocAnalysis,
  type DocBlock,
  type LintIssue,
  type ParsedToken,
} from './whiteboardProtoEngine';

export interface ProtoCmUiState {
  isMobile: boolean;
  activeTokenId: string | null;
  editorMode: string | null;
  overflowBlockIdx: number | null;
}

export interface ProtoCmCallbacks {
  getCatalogs: () => CatalogStore;
  onSync: (view: EditorView, analysis: DocAnalysis) => void;
  onPickToken: (lineNum: number, token: ParsedToken, anchorEl: HTMLElement) => void;
  onPickAdd: (lineNum: number, anchorEl: HTMLElement) => void;
  onOpenBlock: (blockIdx: number, anchorEl: HTMLElement) => void;
  onPlayBlock: (blockIdx: number) => void;
  onBlockCmdToast: (msg: string) => void;
  onToggleOverflow: (blockIdx: number, anchorEl: HTMLElement) => void;
  onApplyQuickFix: (lineNum: number, token: ParsedToken, fixVal: string) => void;
  onInsertTemplate: (blockIdx: number, templateId: string) => void;
  onProseFormat: (lineNum: number, kind: 'bold' | 'italic' | 'strike' | 'code' | 'wrapTimeBlock') => void;
  onOpenWikiPicker: (lineNum: number, anchorEl: HTMLElement) => void;
  onOpenProseTagPicker: (lineNum: number, anchorEl: HTMLElement) => void;
  onShortcutInspect: () => void;
  onToggleDrawer: () => void;
}

export const catalogRefreshEffect = StateEffect.define<number>();
export const protoUiEffect = StateEffect.define<ProtoCmUiState>();

export function createProtoInputModeCompartment(): Compartment {
  return new Compartment();
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function widgetSvg(iconKey: string, size = 13): string {
  const paths: Record<string, string> = {
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M9 2h6"/>',
    rest: '<path d="M10 2h4"/><path d="M12 14v-4"/><path d="M4 13a8 8 0 0 1 16 0c0 4.4-3.6 8-8 8s-8-3.6-8-8Z"/>',
    rounds: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
    rep: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
    effort: '<path d="m6.5 6.5 11 11"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/><path d="m2 6 4-4"/><path d="m3 10 7-7"/><path d="m14 21 7-7"/>',
    equipment: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/>',
    resistance: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
    distance: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
    action: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    wiki: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    error: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    sparkles: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
    italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
    strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
    blocks: '<rect width="7" height="7" x="14" y="3" rx="1"/><path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"/>',
  };
  const d = paths[iconKey] ?? paths.code;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

/* ── Block & Inline CodeMirror 6 Widgets ──────────────────────────────── */

class BlockHeaderWidget extends WidgetType {
  constructor(
    private readonly block: DocBlock,
    private readonly overflowOpen: boolean,
    private readonly cbRef: { current: ProtoCmCallbacks },
  ) {
    super();
  }

  eq(other: BlockHeaderWidget): boolean {
    return (
      other.block.blockIdx === this.block.blockIdx &&
      other.block.dialect === this.block.dialect &&
      other.block.sport === this.block.sport &&
      other.block.summary.nonEmptyLines === this.block.summary.nonEmptyLines &&
      other.block.summary.durLabel === this.block.summary.durLabel &&
      other.block.summary.errCount === this.block.summary.errCount &&
      other.overflowOpen === this.overflowOpen
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'wb-block-header';
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', `Workout block ${this.block.blockIdx + 1} controls`);

    const dialectLabel = this.block.dialect === 'time' ? 'TIMER' : this.block.dialect === 'log' ? 'LOG' : 'QUERY';
    const sum = this.block.summary;
    const summaryText = `${sum.nonEmptyLines} lines · ${sum.durLabel}${sum.errCount ? ` · ${sum.errCount} error` : ''}`;

    wrap.innerHTML = `
      <div class="wb-fence-group">
        <span class="wb-fence-mark">\`\`\`${esc(this.block.dialect)}</span>
        <button type="button" class="wb-dialect-pill is-${esc(this.block.dialect)}" data-wb-open-block="${this.block.blockIdx}" aria-label="Configure timer block dialect">
          ${widgetSvg('timer', 13)}<span>${dialectLabel}</span>
        </button>
        <button type="button" class="wb-sport-pill" data-wb-open-block="${this.block.blockIdx}">${esc(this.block.sport ? `:${this.block.sport}` : ':sport')}</button>
        <span class="wb-summary-text wb-tabular">${esc(summaryText)}</span>
      </div>
      <div class="wb-cmd-group">
        <button type="button" class="wb-btn wb-btn-primary" data-wb-play="${this.block.blockIdx}">
          ${widgetSvg('play', 13)}<span>Play</span>
        </button>
        <div class="wb-cmd-secondary">
          <button type="button" class="wb-btn wb-btn-secondary" data-wb-toast="Shared workout link">Share</button>
          <button type="button" class="wb-btn wb-btn-secondary" data-wb-toast="Added to Today">+ Today</button>
          <button type="button" class="wb-btn wb-btn-secondary" data-wb-toast="Scheduled">Schedule</button>
        </div>
        <button type="button" class="wb-icon-btn wb-cmd-overflow" data-wb-overflow="${this.block.blockIdx}" aria-label="More block actions" aria-expanded="${this.overflowOpen}">
          ${widgetSvg('more', 16)}
        </button>
      </div>
    `;

    wrap.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });
    wrap.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const openBtn = target.closest<HTMLElement>('[data-wb-open-block]');
      if (openBtn) {
        this.cbRef.current.onOpenBlock(this.block.blockIdx, openBtn);
        return;
      }
      const playBtn = target.closest<HTMLElement>('[data-wb-play]');
      if (playBtn) {
        this.cbRef.current.onPlayBlock(this.block.blockIdx);
        return;
      }
      const toastBtn = target.closest<HTMLElement>('[data-wb-toast]');
      if (toastBtn) {
        this.cbRef.current.onBlockCmdToast(toastBtn.getAttribute('data-wb-toast') ?? '');
        return;
      }
      const ovBtn = target.closest<HTMLElement>('[data-wb-overflow]');
      if (ovBtn) {
        this.cbRef.current.onToggleOverflow(this.block.blockIdx, ovBtn);
      }
    });

    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class EmptyStarterWidget extends WidgetType {
  constructor(
    private readonly blockIdx: number,
    private readonly dialect: string,
    private readonly cbRef: { current: ProtoCmCallbacks },
  ) {
    super();
  }

  eq(other: EmptyStarterWidget): boolean {
    return other.blockIdx === this.blockIdx && other.dialect === this.dialect;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'wb-empty-starter';
    const starters = WORKOUT_TEMPLATES.slice(0, 5)
      .map(
        (tpl) =>
          `<button type="button" class="wb-choice-pill" data-wb-tpl="${esc(tpl.id)}">${widgetSvg('sparkles', 13)}<span>${esc(tpl.name)}</span></button>`,
      )
      .join('');
    wrap.innerHTML = `
      <div class="wb-starter-prompt">Empty <code>\`\`\`${esc(this.dialect)}</code> block — pick a template or type directly above:</div>
      <div class="wb-starter-chips">${starters}</div>
    `;
    wrap.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });
    wrap.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-wb-tpl]');
      if (btn) {
        const id = btn.getAttribute('data-wb-tpl');
        if (id) this.cbRef.current.onInsertTemplate(this.blockIdx, id);
      }
    });
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class TokenStripWidget extends WidgetType {
  private readonly key: string;

  constructor(
    private readonly lineNum: number,
    private readonly tokens: ParsedToken[],
    private readonly activeTokenId: string | null,
    private readonly editorMode: string | null,
    private readonly cbRef: { current: ProtoCmCallbacks },
  ) {
    super();
    this.key = `${lineNum}:${tokens.map((t) => `${t.id}=${t.kind}:${t.raw}`).join('|')}:${activeTokenId ?? ''}:${editorMode ?? ''}`;
  }

  eq(other: TokenStripWidget): boolean {
    return other.key === this.key;
  }

  toDOM(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'wb-token-strip';
    row.setAttribute('role', 'toolbar');
    row.setAttribute('aria-label', 'Line syntax tokens');

    for (const tok of this.tokens) {
      const chip = tokenChipDescriptor(tok);
      const isAct = this.editorMode === 'token' && this.activeTokenId === tok.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `wb-tok-chip${isAct ? ' is-active' : ''}`;
      btn.setAttribute('data-kind', tok.kind);
      btn.setAttribute('data-wb-tok-id', tok.id);
      if (tok.kind === 'duration' && tok.meta.mode === 'rest') btn.setAttribute('data-rest', 'true');
      btn.innerHTML = `${widgetSvg(chip.icon, 13)}<span>${esc(chip.text)}</span>`;
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        this.cbRef.current.onPickToken(this.lineNum, tok, btn);
      });
      row.appendChild(btn);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = `wb-tok-chip is-add${this.editorMode === 'add' ? ' is-active' : ''}`;
    addBtn.setAttribute('data-wb-add', 'true');
    addBtn.innerHTML = `${widgetSvg('plus', 13)}<span>Add</span>`;
    addBtn.addEventListener('mousedown', (e) => e.preventDefault());
    addBtn.addEventListener('click', () => {
      this.cbRef.current.onPickAdd(this.lineNum, addBtn);
    });
    row.appendChild(addBtn);

    return row;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class LintBannerWidget extends WidgetType {
  private readonly key: string;

  constructor(
    private readonly lineNum: number,
    private readonly errors: LintIssue[],
    private readonly cbRef: { current: ProtoCmCallbacks },
  ) {
    super();
    this.key = `${lineNum}:${errors.map((e) => `${e.token.id}:${e.token.raw}`).join('|')}`;
  }

  eq(other: LintBannerWidget): boolean {
    return other.key === this.key;
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'wb-lint-stack';
    for (const err of this.errors) {
      const banner = document.createElement('div');
      banner.className = 'wb-lint-banner';
      banner.setAttribute('role', 'alert');

      const msg = document.createElement('div');
      msg.className = 'wb-lint-msg';
      msg.innerHTML = `${widgetSvg('error', 15)}<span>${esc(err.message)}</span>`;
      banner.appendChild(msg);

      const fixes = document.createElement('div');
      fixes.className = 'wb-lint-fixes';
      for (const fx of err.fixes) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wb-btn wb-btn-primary';
        b.textContent = `Fix: ${fx}`;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          this.cbRef.current.onApplyQuickFix(this.lineNum, err.token, fx);
        });
        fixes.appendChild(b);
      }
      banner.appendChild(fixes);
      container.appendChild(banner);
    }
    return container;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class ProseToolbarWidget extends WidgetType {
  private readonly key: string;

  constructor(
    private readonly lineNum: number,
    private readonly lineText: string,
    private readonly cbRef: { current: ProtoCmCallbacks },
  ) {
    super();
    this.key = `${lineNum}:${lineText}`;
  }

  eq(other: ProseToolbarWidget): boolean {
    return other.key === this.key;
  }

  toDOM(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'wb-prose-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Prose formatting and wiki actions');

    const hasBold = /\*\*[^*]+\*\*/.test(this.lineText);
    const hasItalic = /(?:^|[^*])\*[^*]+\*(?:[^*]|$)/.test(this.lineText);
    const hasStrike = /~~[^~]+~~/.test(this.lineText);
    const hasCode = /`[^`]+`/.test(this.lineText);

    const fmtButtons: Array<{ kind: 'bold' | 'italic' | 'strike' | 'code' | 'wrapTimeBlock'; label: string; icon: string; active: boolean }> = [
      { kind: 'bold', label: 'Bold', icon: 'bold', active: hasBold },
      { kind: 'italic', label: 'Italic', icon: 'italic', active: hasItalic },
      { kind: 'strike', label: 'Strike', icon: 'strike', active: hasStrike },
      { kind: 'code', label: 'Code', icon: 'code', active: hasCode },
    ];

    for (const fb of fmtButtons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `wb-prose-tool-btn${fb.active ? ' is-active' : ''}`;
      btn.setAttribute('aria-pressed', String(fb.active));
      btn.innerHTML = `${widgetSvg(fb.icon, 13)}<span>${fb.label}</span>`;
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => this.cbRef.current.onProseFormat(this.lineNum, fb.kind));
      bar.appendChild(btn);
    }

    const wikiBtn = document.createElement('button');
    wikiBtn.type = 'button';
    wikiBtn.className = 'wb-prose-tool-btn';
    wikiBtn.innerHTML = `${widgetSvg('wiki', 13)}<span>[[Link]]</span>`;
    wikiBtn.addEventListener('mousedown', (e) => e.preventDefault());
    wikiBtn.addEventListener('click', () => this.cbRef.current.onOpenWikiPicker(this.lineNum, wikiBtn));
    bar.appendChild(wikiBtn);

    const tagBtn = document.createElement('button');
    tagBtn.type = 'button';
    tagBtn.className = 'wb-prose-tool-btn';
    tagBtn.innerHTML = `${widgetSvg('tag', 13)}<span>#Tag</span>`;
    tagBtn.addEventListener('mousedown', (e) => e.preventDefault());
    tagBtn.addEventListener('click', () => this.cbRef.current.onOpenProseTagPicker(this.lineNum, tagBtn));
    bar.appendChild(tagBtn);

    const wrapBtn = document.createElement('button');
    wrapBtn.type = 'button';
    wrapBtn.className = 'wb-prose-tool-btn';
    wrapBtn.innerHTML = `${widgetSvg('blocks', 13)}<span>Wrap in \`\`\`time</span>`;
    wrapBtn.addEventListener('mousedown', (e) => e.preventDefault());
    wrapBtn.addEventListener('click', () => this.cbRef.current.onProseFormat(this.lineNum, 'wrapTimeBlock'));
    bar.appendChild(wrapBtn);

    return bar;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/* ── CodeMirror 6 Autocompletion Source ──────────────────────────────── */

function createWhiteboardCompletionSource(
  analysisField: StateField<DocAnalysis>,
  getCatalogs: () => CatalogStore,
) {
  return (context: CompletionContext): CompletionResult | null => {
    const analysis = context.state.field(analysisField);
    const catalogs = getCatalogs();
    const line = context.state.doc.lineAt(context.pos);
    const linePrefix = line.text.slice(0, context.pos - line.from);
    const inWod = analysis.wodLineMap.has(line.number);

    // 1. Inside WOD blocks: `/template`, `[:action]`, `#tag` (without trailing space), or fuzzy effort/equipment
    if (inWod) {
      // Template trigger: `/` at start or after whitespace
      const slashM = /(?:^|\s)(\/[a-zA-Z0-9-]*)$/.exec(linePrefix);
      if (slashM) {
        const q = slashM[1].slice(1).toLowerCase();
        const from = context.pos - slashM[1].length;
        const options: Completion[] = WORKOUT_TEMPLATES.filter(
          (tpl) => !q || tpl.id.includes(q) || tpl.name.toLowerCase().includes(q),
        ).map((tpl) => ({
          label: `/${tpl.id}`,
          displayLabel: tpl.name,
          detail: tpl.lines[0],
          info: tpl.desc,
          apply: tpl.lines.join('\n'),
          type: 'keyword',
        }));
        return { from, options, validFor: /^\/[a-zA-Z0-9-]*$/ };
      }

      // Action cue trigger: `[:...`
      const actM = /(\[:[a-zA-Z0-9-]*)$/.exec(linePrefix);
      if (actM) {
        const from = context.pos - actM[1].length;
        const options: Completion[] = ACTION_CUES.map((a) => ({
          label: a.code,
          detail: a.label,
          info: a.desc,
          apply: `${a.code} `,
          type: 'keyword',
        }));
        return { from, options, validFor: /^\[:[a-zA-Z0-9-]*$/ };
      }

      // Tag trigger: `#` or `#slug` (NOTE: `# ` with trailing space is a heading, NOT a tag)
      const tagM = /(?:^|\s)(#[a-zA-Z0-9-]*)$/.exec(linePrefix);
      if (tagM) {
        const typed = tagM[1].slice(1).toLowerCase();
        const from = context.pos - tagM[1].length;
        const options: Completion[] = catalogs.tags
          .filter((t) => !typed || t.slug.toLowerCase().includes(typed) || t.group.toLowerCase().includes(typed))
          .map((t) => ({
            label: `#${t.slug}`,
            detail: t.group,
            info: t.desc,
            apply: `#${t.slug} `,
            type: 'variable',
          }));
        return { from, options, validFor: /^#[a-zA-Z0-9-]*$/ };
      }

      // Fuzzy & alias effort / equipment trigger (2+ letters or explicit Ctrl+Space)
      const wordM = /([a-zA-Z][a-zA-Z0-9-]*)$/.exec(linePrefix);
      if (wordM && (wordM[1].length >= 2 || context.explicit)) {
        const typed = wordM[1];
        const from = context.pos - typed.length;
        const effRes = searchEfforts(typed, analysis.frontmatter.notebook, catalogs);
        const effOpts: Completion[] = [...effRes.scoped, ...effRes.other].map((e, idx) => ({
          label: e.name,
          detail: e.aliases.length ? `${e.category} (${e.aliases[0]})` : e.category,
          info: e.defaultEquipment ? `Equipment: ${e.defaultEquipment}` : e.category,
          apply: `${e.name} `,
          boost: effRes.scoped.includes(e) ? 20 - idx : -idx,
          type: 'function',
        }));
        const eqOpts: Completion[] = catalogs.equipment
          .filter((eq) => fuzzyMatches(typed, [eq.name, eq.desc]))
          .map((eq) => ({
            label: eq.name,
            detail: 'Equipment',
            info: eq.desc,
            apply: `${eq.name} `,
            type: 'property',
          }));
        const options = [...effOpts, ...eqOpts];
        if (options.length) {
          return { from, options, validFor: /^[a-zA-Z0-9-]*$/ };
        }
      }

      if (context.explicit) {
        const options: Completion[] = [
          ...WORKOUT_TEMPLATES.slice(0, 4).map((tpl) => ({
            label: `/${tpl.id}`,
            displayLabel: `Template: ${tpl.name}`,
            detail: tpl.lines[0],
            apply: tpl.lines.join('\n'),
            type: 'keyword',
          })),
          ...catalogs.efforts.slice(0, 6).map((e) => ({
            label: e.name,
            detail: e.category,
            apply: `${e.name} `,
            type: 'function',
          })),
        ];
        return { from: context.pos, options };
      }
      return null;
    }

    // 2. Outside WOD blocks (Markdown prose): `[[Wiki Link]]` and `#tag`
    const wikiM = /(\[\[[^\]]*)$/.exec(linePrefix);
    if (wikiM) {
      const typed = wikiM[1].slice(2).toLowerCase();
      const from = context.pos - wikiM[1].length;
      const options: Completion[] = catalogs.wikiNotes
        .filter((n) => !typed || fuzzyMatches(typed, [n.title, n.slug, n.summary, ...n.tags]))
        .map((n) => ({
          label: `[[${n.title}]]`,
          detail: n.tags.join(' '),
          info: n.summary,
          apply: `[[${n.title}]] `,
          type: 'class',
        }));
      return { from, options, validFor: /^\[\[[^\]]*$/ };
    }

    const proseTagM = /(?:^|\s)(#[a-zA-Z0-9-]*)$/.exec(linePrefix);
    if (proseTagM) {
      const typed = proseTagM[1].slice(1).toLowerCase();
      const from = context.pos - proseTagM[1].length;
      const options: Completion[] = catalogs.tags
        .filter((t) => !typed || t.slug.toLowerCase().includes(typed))
        .map((t) => ({
          label: `#${t.slug}`,
          detail: t.group,
          info: t.desc,
          apply: `#${t.slug} `,
          type: 'variable',
        }));
      return { from, options, validFor: /^#[a-zA-Z0-9-]*$/ };
    }

    return null;
  };
}

/* ── Extension Factory ─────────────────────────────────────────────────── */

export function createWhiteboardProtoExtensions(
  initialUi: ProtoCmUiState,
  callbacksRef: { current: ProtoCmCallbacks },
  inputModeCompartment: Compartment,
): {
  extensions: Extension[];
  analysisField: StateField<DocAnalysis>;
  uiStateField: StateField<ProtoCmUiState>;
} {
  const analysisField = StateField.define<DocAnalysis>({
    create(state) {
      return scanDocument(state.doc.toString(), callbacksRef.current.getCatalogs());
    },
    update(value, tr) {
      const needsRefresh = tr.docChanged || tr.effects.some((e) => e.is(catalogRefreshEffect));
      return needsRefresh ? scanDocument(tr.state.doc.toString(), callbacksRef.current.getCatalogs()) : value;
    },
  });

  const uiStateField = StateField.define<ProtoCmUiState>({
    create() {
      return initialUi;
    },
    update(value, tr) {
      for (const eff of tr.effects) {
        if (eff.is(protoUiEffect)) return eff.value;
      }
      return value;
    },
  });

  const decorationsField = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state);
    },
    update(value, tr) {
      if (
        tr.docChanged ||
        tr.selection !== undefined ||
        tr.effects.some((e) => e.is(catalogRefreshEffect) || e.is(protoUiEffect))
      ) {
        return buildDecorations(tr.state);
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  function buildDecorations(state: EditorState): DecorationSet {
    const analysis = state.field(analysisField);
    const ui = state.field(uiStateField);
    const cursorPos = state.selection.main.head;
    const cursorLine = state.doc.lineAt(cursorPos).number;

    const decos: Range<Decoration>[] = [];

    // 1. Block headers & empty-block starters
    for (const blk of analysis.blocks) {
      if (blk.fenceStartLine <= state.doc.lines) {
        const openLine = state.doc.line(blk.fenceStartLine);
        decos.push(
          Decoration.widget({
            widget: new BlockHeaderWidget(blk, ui.overflowBlockIdx === blk.blockIdx, callbacksRef),
            block: true,
            side: -1,
          }).range(openLine.from),
        );
        decos.push(Decoration.line({ class: 'cm-wb-fence-line cm-wb-fence-open' }).range(openLine.from));
      }

      if (blk.fenceEndLine <= state.doc.lines) {
        const closeLine = state.doc.line(blk.fenceEndLine);
        decos.push(Decoration.line({ class: 'cm-wb-fence-line cm-wb-fence-close' }).range(closeLine.from));
      }

      const isEmptyBlock = blk.lines.length === 1 && !blk.lines[0].text.trim();
      if (isEmptyBlock && blk.contentStartLine <= state.doc.lines) {
        const emptyLine = state.doc.line(blk.contentStartLine);
        decos.push(
          Decoration.widget({
            widget: new EmptyStarterWidget(blk.blockIdx, blk.dialect, callbacksRef),
            block: true,
            side: 1,
          }).range(emptyLine.to),
        );
      }
    }

    // 2. WOD line decorations, semantic token marks, inline token strip & lint banner
    for (const [lineNum, entry] of analysis.wodLineMap.entries()) {
      if (lineNum > state.doc.lines) continue;
      const line = state.doc.line(lineNum);
      const isAct = lineNum === cursorLine;
      const hasErr = entry.parsed.errors.length > 0;
      const lineCls = `cm-wb-block-line${isAct ? ' is-active' : ''}${hasErr ? ' has-error' : ''}`;
      decos.push(Decoration.line({ class: lineCls }).range(line.from));

      for (const tok of entry.parsed.tokens) {
        const from = Math.max(line.from, Math.min(line.from + tok.from, line.to));
        const to = Math.max(from, Math.min(line.from + tok.to, line.to));
        if (to > from) {
          let cls = `cm-wb-tok cm-wb-${tok.kind}`;
          if (tok.kind === 'duration' && tok.meta.mode === 'rest') cls += ' is-rest';
          if (isAct && ui.activeTokenId === tok.id) cls += ' is-focused-tok';
          decos.push(Decoration.mark({ class: cls }).range(from, to));
        }
      }

      if (isAct && !ui.isMobile) {
        decos.push(
          Decoration.widget({
            widget: new TokenStripWidget(lineNum, entry.parsed.tokens, ui.activeTokenId, ui.editorMode, callbacksRef),
            block: true,
            side: 1,
          }).range(line.to),
        );
      }

      if (isAct && hasErr) {
        decos.push(
          Decoration.widget({
            widget: new LintBannerWidget(lineNum, entry.parsed.errors, callbacksRef),
            block: true,
            side: 2,
          }).range(line.to),
        );
      }
    }

    // 3. Prose wiki-link / tag marks + Desktop/Tablet formatting bar
    for (const pLineNum of analysis.proseLineSet) {
      if (pLineNum > state.doc.lines) continue;
      const line = state.doc.line(pLineNum);
      const wikiRe = /\[\[[^\]]+\]\]/g;
      let wm: RegExpExecArray | null;
      while ((wm = wikiRe.exec(line.text)) !== null) {
        decos.push(Decoration.mark({ class: 'cm-wb-wiki-link' }).range(line.from + wm.index, line.from + wm.index + wm[0].length));
      }
      const tagRe = /(?:^|\s)(#[a-zA-Z0-9-]+)/g;
      let tm: RegExpExecArray | null;
      while ((tm = tagRe.exec(line.text)) !== null) {
        const start = line.from + tm.index + tm[0].length - tm[1].length;
        decos.push(Decoration.mark({ class: 'cm-wb-prose-tag' }).range(start, start + tm[1].length));
      }

      if (pLineNum === cursorLine && !ui.isMobile) {
        decos.push(
          Decoration.widget({
            widget: new ProseToolbarWidget(pLineNum, line.text, callbacksRef),
            block: true,
            side: 1,
          }).range(line.to),
        );
      }
    }

    return Decoration.set(decos, true);
  }

  const syncListener = EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.docChanged && update.transactions.some((tr) => tr.isUserEvent('input.type'))) {
      const head = update.state.selection.main.head;
      const line = update.state.doc.lineAt(head);
      const prefix = line.text.slice(0, head - line.from);
      if (/(?:^|\s)[#/]$/.test(prefix) || prefix.endsWith('[[') || prefix.endsWith('[:')) {
        queueMicrotask(() => startCompletion(update.view));
      }
    }
    if (
      update.docChanged ||
      update.selectionSet ||
      update.transactions.some((tr) => tr.effects.some((e) => e.is(catalogRefreshEffect)))
    ) {
      const analysis = update.state.field(analysisField);
      callbacksRef.current.onSync(update.view, analysis);
    }
  });

  const protoKeymap = Prec.highest(
    keymap.of([
      {
        key: 'Mod-.',
        run: () => {
          callbacksRef.current.onShortcutInspect();
          return true;
        },
      },
      {
        key: 'Mod-Shift-i',
        run: () => {
          callbacksRef.current.onToggleDrawer();
          return true;
        },
      },
      {
        key: 'Alt-ArrowUp',
        run: (view) => {
          const change = computeSmartIncrementChange(view.state.doc, view.state.selection.main.head, 1, callbacksRef.current.getCatalogs());
          if (!change) return false;
          view.dispatch({
            changes: { from: change.from, to: change.to, insert: change.insert },
            selection: { anchor: change.nextCursorPos },
          });
          return true;
        },
      },
      {
        key: 'Alt-ArrowDown',
        run: (view) => {
          const change = computeSmartIncrementChange(view.state.doc, view.state.selection.main.head, -1, callbacksRef.current.getCatalogs());
          if (!change) return false;
          view.dispatch({
            changes: { from: change.from, to: change.to, insert: change.insert },
            selection: { anchor: change.nextCursorPos },
          });
          return true;
        },
      },
      {
        key: 'Ctrl-ArrowRight',
        run: (view) => stepTokenCursor(view, 1, analysisField),
      },
      {
        key: 'Ctrl-ArrowLeft',
        run: (view) => stepTokenCursor(view, -1, analysisField),
      },
    ]),
  );

  const extensions: Extension[] = [
    history(),
    markdown(),
    analysisField,
    uiStateField,
    decorationsField,
    inputModeCompartment.of(EditorView.contentAttributes.of({ inputmode: initialUi.isMobile ? 'none' : 'text' })),
    autocompletion({
      override: [createWhiteboardCompletionSource(analysisField, () => callbacksRef.current.getCatalogs())],
      activateOnTyping: true,
    }),
    protoKeymap,
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.lineWrapping,
    placeholder('Write training notes, [[wiki links]], or ```time workout blocks…'),
    syncListener,
  ];

  return { extensions, analysisField, uiStateField };
}

function stepTokenCursor(view: EditorView, delta: number, analysisField: StateField<DocAnalysis>): boolean {
  const analysis = view.state.field(analysisField);
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const entry = analysis.wodLineMap.get(line.number);
  if (!entry || !entry.parsed.tokens.length) return false;

  const offset = pos - line.from;
  const toks = entry.parsed.tokens;
  let idx = toks.findIndex((t) => offset >= t.from && offset <= t.to);
  if (idx === -1) idx = delta > 0 ? -1 : 0;
  const nextIdx = (idx + delta + toks.length) % toks.length;
  const target = toks[nextIdx];
  view.dispatch({ selection: { anchor: line.from + target.from, head: line.from + target.to } });
  return true;
}
