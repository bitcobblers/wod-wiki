/**
 * `wod init-feed <name>` — scaffold a ready-to-publish WOD Wiki feed
 * repository skeleton (docs/catalogs-and-distributed-seed-model.html §repo-creation,
 * roadmap Phase 4): a markdown notebooks example, package.json, GitHub Actions
 * Pages workflow, README. Creates a new directory only; refuses an existing
 * destination without touching it.
 *
 * Lazily imported by cli/runner.ts (dynamic import), so static node:fs/node:path
 * imports stay out of browser bundles.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { VERSION } from '../version';

export interface ScaffoldFeedResult {
  /** Absolute path of the created feed root. */
  dir: string;
  /** Created files, POSIX-relative to the feed root. */
  files: string[];
}

/** npm package name + single-directory-segment validation for `<name>`. */
export function validateFeedName(name: string): string {
  if (name.length === 0 || name === '.' || name === '..') {
    throw new Error('Feed name must be a single non-empty directory name');
  }
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error(`Invalid feed name '${name}': must be a single directory name (no path separators or traversal)`);
  }
  if (/^(?:[A-Za-z]:)?[/\\]/.test(name)) {
    throw new Error(`Invalid feed name '${name}': absolute paths are not allowed`);
  }
  if (name.length > 214 || !/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new Error(
      `Invalid feed name '${name}': must be a valid npm package name ` +
      '(lowercase letters, digits, dots, hyphens, underscores; no leading dot/hyphen)',
    );
  }
  return name;
}

const publishWorkflow = (): string => `name: Publish feed

# Compile the feed with the wod CLI and deploy dist/ to GitHub Pages.
# Requires Pages enabled: repo Settings → Pages → Source: "GitHub Actions".

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  publish:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
        with:
          # Full history: seed manifest version stamps derive from git commit count.
          fetch-depth: 0

      - name: Set up Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.x

      - name: Install dependencies
        run: bun install

      - name: Build seed
        run: bunx wod build . --output dist

      - uses: actions/configure-pages@v5

      - name: Upload dist
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

      - id: deployment
        uses: actions/deploy-pages@v4
`;

const feedReadme = (name: string): string => `# ${name}

Example benchmark notebook. Each \`.md\` file in this directory becomes part of
the \`example\` notebook chunk; \`README.md\` is the notebook's landing page.

Add one file per workout:

\`\`\`\`markdown
---
title: My workout
date: 2026-01-01
---

# My workout

\`\`\`time
(21-15-9)
  Thrusters @95lb
  Pull-ups
\`\`\`
\`\`\`\`

The \`date:\` frontmatter field sets the workout's chronological placement
(regardless of filename or directory).
`;

const exampleWorkout = (date: string): string => `---
title: Morning session
date: ${date}
---

# Morning session

\`\`\`time
(21-15-9)
  Thrusters @95lb
  Pull-ups
\`\`\`
`;

const repoReadme = (name: string): string => `# ${name}

A [WOD Wiki](https://github.com/bitcobblers/wod-wiki) workout feed: plain
Markdown workouts compiled to static, version-stamped seed chunks and published
via GitHub Pages.

## Develop

\`\`\`sh
bun install
bunx wod build . --output dist
\`\`\`

Workouts live under \`markdown/\` — this scaffold starts with one example
feed. Validate everything with \`bunx wod build\`: it gates every file on
the Whiteboard grammar and corpus layout before writing \`dist/\`.

## Publish

Push to GitHub and enable Pages (**Settings → Pages → Source: GitHub
Actions**). The bundled workflow (\`.github/workflows/publish-feed.yml\`)
builds the feed on every push to \`main\` and deploys \`dist/\`.

## Share

Once published, anyone can subscribe to this feed from a WOD Wiki instance
at:

\`\`\`
<app-url>/subscribe?source=<url-encoded published feed URL>
\`\`\`

For \`owner\`/\`repo\` on GitHub Pages the feed URL is the deployed
directory, \`https://owner.github.io/repo/\`, e.g.
\`/subscribe?source=https%3A%2F%2Fowner.github.io%2Frepo%2F\`.
`;

/**
 * Scaffold a new feed repository at `<cwd>/<name>`. Throws when the name is
 * invalid or the destination already exists; partial failure removes created files.
 */
export function scaffoldFeed(name: string, opts: { cwd?: string } = {}): ScaffoldFeedResult {
  validateFeedName(name);
  const dir = resolve(opts.cwd ?? process.cwd(), name);
  // Atomic acquire: EEXIST is the refusal signal — no exists-check/create race,
  // and an existing destination is never removed or written.
  try {
    mkdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Refusing to overwrite '${dir}': destination already exists`, { cause: error });
    }
    throw error;
  }

  const date = new Date().toISOString().slice(0, 10);
  const files: Array<[rel: string, content: string]> = [
    ['package.json', `${JSON.stringify(
      {
        name,
        version: '0.1.0',
        private: true,
        type: 'module',
        description: `WOD Wiki workout feed: ${name}`,
        scripts: {
          build: 'wod build . --output dist',
        },
        devDependencies: {
          '@bitcobblers/wod-wiki-tools': `^${VERSION}`,
        },
      },
      null,
      2,
    )}\n`],
    ['.gitignore', 'node_modules/\ndist/\n'],
    ['.github/workflows/publish-feed.yml', publishWorkflow()],
    ['markdown/notebooks/example/README.md', feedReadme(name)],
    [`markdown/notebooks/example/morning-session.md`, exampleWorkout(date)],
    ['README.md', repoReadme(name)],
  ];

  try {
    for (const [rel, content] of files) {
      const target = join(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf-8');
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return { dir, files: files.map(([rel]) => rel) };
}
