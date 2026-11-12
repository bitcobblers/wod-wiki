#!/usr/bin/env bun
/**
 * Post-processes Playwright's HTML report (`playwright-report/index.html`):
 * 1. Scans `e2e/** /*.e2e.ts` for `// spec: <path>.md` headers.
 * 2. Renders each linked Markdown spec to semantic HTML and embeds a lookup
 *    map + lightweight DOM injector into the Playwright report so each test
 *    displays its rendered Markdown spec inline.
 * 3. Runs `whiteboard-html/annotate.py --dynamic` to enable offline text
 *    highlighting, block annotations, and feedback export on the report.
 *
 * Usage:
 *   bun scripts/postprocess-playwright-report.ts [path/to/playwright-report/index.html]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

interface SpecEntry {
  specPath: string;
  frontmatter: Record<string, string>;
  html: string;
}

const START_MARKER = '<!-- wod-spec-embed:start -->';
const END_MARKER = '<!-- wod-spec-embed:end -->';

function walkFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkFiles(full, suffix));
    } else if (entry.endsWith(suffix)) {
      out.push(full);
    }
  }
  return out.sort();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInlineMarkdown(text: string): string {
  let out = escapeHtml(text);
  // Inline code first so formatting inside backticks is preserved
  const codeSpans: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => {
    const token = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${code}</code>`);
    return token;
  });
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_m, idx: string) => codeSpans[Number(idx)] ?? '');
  return out;
}

function parseMarkdownSpec(raw: string): { frontmatter: Record<string, string>; html: string } {
  const frontmatter: Record<string, string> = {};
  let body = raw;
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fmMatch) {
    body = raw.slice(fmMatch[0].length);
    for (const line of fmMatch[1]!.split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z0-9_]+):\s*(.+)$/);
      if (kv) {
        frontmatter[kv[1]!] = kv[2]!.trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }

  const lines = body.split(/\r?\n/);
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block
    const fence = line.match(/^```([a-zA-Z0-9_-]*)\s*$/);
    if (fence) {
      const lang = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++;
      blocks.push(`<pre><code${lang}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // Headings
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2]!.trim())}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push('<hr>');
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(`<blockquote><p>${renderInlineMarkdown(quoteLines.join(' '))}</p></blockquote>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
        items.push(`<li>${renderInlineMarkdown(lines[i]!.replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      blocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i]!)) {
        items.push(`<li>${renderInlineMarkdown(lines[i]!.replace(/^[-*+]\s+/, ''))}</li>`);
        i++;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Paragraph (coalesce consecutive plain lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^(#{1,6}\s+|```|>\s?|\d+\.\s+|[-*+]\s+|(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!.trim());
      i++;
    }
    blocks.push(`<p>${renderInlineMarkdown(paraLines.join(' '))}</p>`);
  }

  return { frontmatter, html: blocks.join('\n') };
}

function buildSpecLookup(repoRoot: string): Record<string, SpecEntry> {
  const e2eFiles = walkFiles(join(repoRoot, 'e2e'), '.e2e.ts');
  const lookup: Record<string, SpecEntry> = {};

  for (const absTest of e2eFiles) {
    const content = readFileSync(absTest, 'utf8');
    const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? '';
    const specMatch = firstLine.match(/^\/\/\s*spec:\s*(.+)$/);
    if (!specMatch) continue;

    const relSpec = specMatch[1]!.trim();
    const absSpec = resolve(repoRoot, relSpec);
    if (!existsSync(absSpec)) continue;

    const { frontmatter, html } = parseMarkdownSpec(readFileSync(absSpec, 'utf8'));
    const entry: SpecEntry = { specPath: relSpec, frontmatter, html };

    const relTest = relative(repoRoot, absTest).replace(/\\/g, '/');
    const withoutE2ePrefix = relTest.replace(/^e2e\//, '');
    lookup[relTest] = entry;
    lookup[withoutE2ePrefix] = entry;
    lookup[basename(absTest)] = entry;
  }

  return lookup;
}

function buildEmbedSnippet(lookup: Record<string, SpecEntry>): string {
  const serialized = JSON.stringify(lookup).replace(/<\//g, '<\\/');
  return `${START_MARKER}
<style id="wod-spec-embed-styles">
  .wod-spec-panel {
    margin: 0 0 16px;
    padding: 12px 16px;
    border: 1px solid var(--color-border-default, #d0d7de);
    border-radius: 8px;
    background: var(--color-canvas-subtle, #f6f8fa);
    color: var(--color-fg-default, #1f2328);
    font-size: 14px;
    line-height: 1.55;
  }
  .wod-spec-panel > summary {
    cursor: pointer;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    user-select: none;
  }
  .wod-spec-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--color-fg-muted, #656d76);
  }
  .wod-spec-badge {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--color-border-default, #d0d7de);
    font-size: 11px;
    font-weight: 500;
    color: var(--color-fg-muted, #656d76);
  }
  .wod-spec-body {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--color-border-default, #d0d7de);
  }
  .wod-spec-body h1 { font-size: 18px; margin: 0 0 8px; }
  .wod-spec-body h2 { font-size: 16px; margin: 14px 0 6px; }
  .wod-spec-body h3 { font-size: 14px; margin: 12px 0 4px; }
  .wod-spec-body p { margin: 6px 0; }
  .wod-spec-body ul, .wod-spec-body ol { margin: 6px 0; padding-left: 22px; }
  .wod-spec-body li { margin: 3px 0; }
  .wod-spec-body code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--color-neutral-muted, rgba(175, 184, 193, 0.2));
  }
  .wod-spec-body pre {
    padding: 10px 12px;
    border-radius: 6px;
    overflow: auto;
    background: var(--color-neutral-muted, rgba(175, 184, 193, 0.2));
  }
  .wod-spec-body pre code { padding: 0; background: transparent; }
</style>
<script id="wod-spec-embed-script">
(() => {
  const SPECS = ${serialized};

  function resolveSpecForView(container) {
    const candidates = [
      ...container.querySelectorAll('.test-case-location, .test-file-path, .test-file-path-link, .test-result-path'),
    ];
    for (const el of candidates) {
      const raw = (el.textContent || '').trim();
      const match = raw.match(/([\\w./-]+\\.e2e\\.ts)/);
      if (!match) continue;
      const full = match[1].replace(/\\\\/g, '/');
      const base = full.split('/').pop();
      if (SPECS[full]) return { key: full, spec: SPECS[full] };
      if (base && SPECS[base]) return { key: base, spec: SPECS[base] };
    }
    return null;
  }

  function injectSpecs() {
    const containers = document.querySelectorAll('.test-case-column, .test-result');
    for (const container of containers) {
      if (container.querySelector('.wod-spec-panel')) continue;
      const resolved = resolveSpecForView(container);
      if (!resolved) continue;
      const { spec } = resolved;
      const panel = document.createElement('details');
      panel.className = 'wod-spec-panel';
      panel.open = true;

      const summary = document.createElement('summary');
      const title = document.createElement('span');
      title.textContent = 'Linked Spec';
      const pathSpan = document.createElement('span');
      pathSpan.className = 'wod-spec-path';
      pathSpan.textContent = spec.specPath;
      summary.append(title, pathSpan);

      for (const key of ['domain', 'priority', 'viewports']) {
        if (spec.frontmatter && spec.frontmatter[key]) {
          const badge = document.createElement('span');
          badge.className = 'wod-spec-badge';
          badge.textContent = key + ': ' + spec.frontmatter[key];
          summary.append(badge);
        }
      }

      const body = document.createElement('div');
      body.className = 'wod-spec-body';
      body.innerHTML = spec.html;

      panel.append(summary, body);
      const locationRow = container.querySelector('.test-case-location')?.closest('.hbox');
      if (locationRow && locationRow.parentElement === container) {
        locationRow.insertAdjacentElement('afterend', panel);
      } else {
        container.prepend(panel);
      }
    }
  }

  function start() {
    const root = document.getElementById('root') || document.body;
    if (!root) return;
    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(injectSpecs, 40);
    });
    observer.observe(root, { childList: true, subtree: true });
    injectSpecs();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
</script>
${END_MARKER}`;
}

function main() {
  const repoRoot = resolve(import.meta.dirname, '..');
  const reportArg = process.argv[2] ?? 'playwright-report/index.html';
  const reportPath = resolve(repoRoot, reportArg);

  if (!existsSync(reportPath)) {
    console.error(`Report not found: ${reportPath}`);
    process.exit(1);
  }

  const lookup = buildSpecLookup(repoRoot);
  const specCount = new Set(Object.values(lookup).map((v) => v.specPath)).size;

  let html = readFileSync(reportPath, 'utf8');
  const existingPattern = new RegExp(
    `${START_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?\\n?`,
    'g'
  );
  html = html.replace(existingPattern, '');

  const headCloseIdx = html.indexOf('</head>');
  if (headCloseIdx === -1) {
    console.error(`Invalid HTML report (missing </head>): ${reportPath}`);
    process.exit(1);
  }

  const snippet = buildEmbedSnippet(lookup);
  html = `${html.slice(0, headCloseIdx)}${snippet}\n${html.slice(headCloseIdx)}`;
  writeFileSync(reportPath, html, 'utf8');

  const repoSkillDir = resolve(repoRoot, 'scripts/whiteboard-html');
  const skillDir =
    process.env.WHITEBOARD_HTML_DIR ??
    (existsSync(join(repoSkillDir, 'annotate.py'))
      ? repoSkillDir
      : join(homedir(), '.agents/skills/whiteboard-html'));
  const annotatePy = join(skillDir, 'annotate.py');
  if (!existsSync(annotatePy)) {
    console.error(`whiteboard-html annotate.py not found at ${annotatePy}`);
    process.exit(1);
  }

  const output = execFileSync('python3', [annotatePy, '--dynamic', reportPath], {
    encoding: 'utf8',
  });
  console.log(`Embedded ${specCount} linked Markdown specs into ${reportPath}`);
  console.log(output.trim());
}

main();
