/**
 * Zero-Orphan Gate: Verifies all `*.{test,spec}.{ts,tsx}` files in `packages/*`
 * and `apps/*` are matched by an active runner glob in `bun run test`.
 */
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface ActiveRunnerRule {
  name: string;
  pattern: RegExp;
}

export const ACTIVE_RUNNER_RULES: ActiveRunnerRule[] = [
  { name: 'vitest-core', pattern: /^packages\/core\/tests\/.*\.test\.ts$/ },
  { name: 'vitest-lang', pattern: /^packages\/lang\/tests\/.*\.test\.ts$/ },
  { name: 'vitest-storage', pattern: /^packages\/storage\/tests\/.*\.test\.ts$/ },
  { name: 'vitest-wql', pattern: /^packages\/wql\/tests\/.*\.test\.ts$/ },
  { name: 'vitest-engine', pattern: /^packages\/engine\/tests\/.*\.test\.ts$/ },
  { name: 'vitest-tools', pattern: /^packages\/tools\/tests\/.*\.test\.ts$/ },
  { name: 'vitest-ui', pattern: /^packages\/ui\/(src|test)\/.*\.(test|spec)\.(ts|tsx)$/ },
  { name: 'vitest-playground', pattern: /^apps\/playground\/(src|app)\/.*\.(test|spec)\.(ts|tsx)$/ },
  { name: 'vitest-storybook', pattern: /^apps\/storybook\/test\/.*\.(test|spec)\.(ts|tsx)$/ },
];

export function scanTestFiles(baseDir: string): string[] {
  const results: string[] = [];
  function walk(currentDir: string): void {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === 'dist-api' ||
          entry.name === '.git' ||
          entry.name === 'storybook-static'
        ) {
          continue;
        }
        walk(full);
      } else if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(baseDir);
  return results;
}

export function findOrphanTests(rootDir: string = process.cwd()): string[] {
  const packagesDir = join(rootDir, 'packages');
  const appsDir = join(rootDir, 'apps');
  const allTestFiles = [...scanTestFiles(packagesDir), ...scanTestFiles(appsDir)];

  const orphans: string[] = [];
  for (const absPath of allTestFiles) {
    const relPath = relative(rootDir, absPath).replace(/\\/g, '/');
    const isMatched = ACTIVE_RUNNER_RULES.some((rule) => rule.pattern.test(relPath));
    if (!isMatched) {
      orphans.push(relPath);
    }
  }

  return orphans.sort();
}

if (import.meta.main) {
  const orphans = findOrphanTests();
  if (orphans.length > 0) {
    console.error(`❌ Found ${orphans.length} orphan test file(s) not covered by any active runner:`);
    for (const file of orphans) {
      console.error(`  - ${file}`);
    }
    process.exit(1);
  } else {
    console.log('✅ Zero orphan test files found across packages/* and apps/*.');
    process.exit(0);
  }
}
