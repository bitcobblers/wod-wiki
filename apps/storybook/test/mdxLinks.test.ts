import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC_ROOT = path.resolve(import.meta.dirname, '../src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

/** Replicates Storybook's `sanitize` + `toId` slugification for CSF titles & exports. */
function sanitize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function storyExportToSlug(exportName: string): string {
  // Storybook turns PascalCase export names into kebab-case (e.g. OptionAAnchoredInspector -> option-a-anchored-inspector)
  return sanitize(
    exportName
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2'),
  );
}

function collectValidIds(): Set<string> {
  const valid = new Set<string>();
  for (const file of walk(SRC_ROOT)) {
    const txt = readFileSync(file, 'utf8');
    if (file.endsWith('.mdx')) {
      const m = txt.match(/<Meta\s+title=["']([^"']+)["']/);
      if (m) {
        valid.add(`/docs/${sanitize(m[1])}--docs`);
      }
      continue;
    }
    if (file.endsWith('.stories.tsx')) {
      const metaIdx = txt.search(/const\s+meta\b|export\s+default\s+\{/);
      if (metaIdx === -1) continue;
      const metaHead = txt.slice(metaIdx, metaIdx + 400);
      const explicitId = metaHead.match(/\bid:\s*['"]([^'"]+)['"]/)?.[1];
      const title = metaHead.match(/\btitle:\s*['"]([^'"]+)['"]/)?.[1];
      const prefix = explicitId ?? (title ? sanitize(title) : null);
      if (!prefix) continue;
      valid.add(`/docs/${prefix}--docs`);
      for (const m of txt.matchAll(/export\s+const\s+(\w+)\s*(?::\s*Story(?:Obj)?[^=]*)?=/g)) {
        const name = m[1];
        if (name === 'meta') continue;
        valid.add(`/story/${prefix}--${storyExportToSlug(name)}`);
      }
    }
  }
  return valid;
}

describe('Storybook MDX deep-link integrity', () => {
  it('resolves every ?path=/story/... and ?path=/docs/... link in MDX files to an existing story or doc', () => {
    const validIds = collectValidIds();
    const mdxFiles = walk(SRC_ROOT).filter((f) => f.endsWith('.mdx'));
    const broken: string[] = [];

    for (const file of mdxFiles) {
      const txt = readFileSync(file, 'utf8');
      for (const m of txt.matchAll(/\?path=(\/(?:story|docs)\/[a-z0-9-]+)/g)) {
        const target = m[1];
        if (!validIds.has(target)) {
          broken.push(`${path.relative(SRC_ROOT, file)} -> ${target}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });
});
