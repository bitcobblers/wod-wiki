// Tests for scripts/generate-build-summary.mjs using real temporary git repositories.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateBuildSummary, renderBuildSummaryMarkdown } from './generate-build-summary.mjs';

const CLI = path.resolve(import.meta.dir, 'generate-build-summary.mjs');

let tmpDir;

function git(cwd, args, env = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test Author',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test Author',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeAndCommit(cwd, files, message) {
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(cwd, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
  }
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-summary-test-'));
  git(tmpDir, ['init', '-b', 'main']);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('generateBuildSummary', () => {
  it('identifies latest release tag, built commit details, git commands, and testing scope', () => {
    const releaseSha = writeAndCommit(
      tmpDir,
      { 'package.json': '{"name":"test","version":"0.10.0"}\n' },
      'chore: release 0.10.0',
    );
    git(tmpDir, ['tag', 'v0.10.0']);

    const builtSha = writeAndCommit(
      tmpDir,
      {
        'packages/engine/src/index.ts': 'export const x = 1;\n',
        'apps/playground/src/App.tsx': 'export function App() { return null; }\n',
        'e2e/specs/journal/timer.md': '# Timer journey\n',
        'markdown/wod/fran.md': '# Fran\n',
      },
      'feat(engine): add timer feature',
    );

    const summary = generateBuildSummary({
      cwd: tmpDir,
      version: '0.11.42',
      tag: 'v0.11.42',
      slug: 'main',
      bundleHash: 'abc1234',
      slugResult: 'success',
      buildVerifyResult: 'success',
      packagesStatus: 'success',
      playgroundStatus: 'success',
      storybookStatus: 'success',
      deployPlaygroundResult: 'success',
      deployStorybookResult: 'success',
      deployOntologyResult: 'success',
      buildDate: '2026-11-16',
      generatedAt: '2026-11-16T18:00:00.000Z',
    });

    expect(summary.overallStatus).toBe('passed');
    expect(summary.failedJobs).toEqual([]);
    expect(summary.lastReleaseCommit.tag).toBe('v0.10.0');
    expect(summary.lastReleaseCommit.isRootFallback).toBe(false);
    expect(summary.lastReleaseCommit.sha).toBe(releaseSha);
    expect(summary.lastReleaseCommit.shortSha).toBe(releaseSha.slice(0, 7));
    expect(summary.lastReleaseCommit.subject).toBe('chore: release 0.10.0');

    expect(summary.builtCommit.sha).toBe(builtSha);
    expect(summary.builtCommit.shortSha).toBe(builtSha.slice(0, 7));
    expect(summary.builtCommit.subject).toBe('feat(engine): add timer feature');

    expect(summary.gitCommands.diff).toBe(`git diff ${releaseSha}..${builtSha}`);
    expect(summary.gitCommands.diffStat).toBe(`git diff --stat ${releaseSha}..${builtSha}`);
    expect(summary.gitCommands.log).toBe(`git log --oneline ${releaseSha}..${builtSha}`);
    expect(summary.gitCommands.diffByTag).toBe(`git diff v0.10.0..${builtSha}`);

    expect(summary.changes.commitCount).toBe(1);
    expect(summary.changes.changedFileCount).toBe(4);

    const scopes = summary.testingScope.scopes.map((s) => s.scope);
    expect(scopes).toContain('packages-unit-and-typecheck');
    expect(scopes).toContain('api-server-and-sqlite');
    expect(scopes).toContain('playground-e2e');
    expect(scopes).toContain('storybook');
    expect(scopes).toContain('seed-corpus');
    expect(summary.testingScope.touchedE2eDomains).toEqual(['journal']);
    expect(summary.testingScope.touchedE2eFiles).toEqual(['e2e/specs/journal/timer.md']);
  });

  it('produces the exact same output structure for passed and failed builds', () => {
    writeAndCommit(tmpDir, { 'README.md': '# Init\n' }, 'chore: init');
    git(tmpDir, ['tag', 'v1.0.0']);
    writeAndCommit(tmpDir, { 'packages/core/src/a.ts': 'export const a = 1;\n' }, 'fix(core): update a');

    const baseOpts = {
      cwd: tmpDir,
      version: '1.0.1',
      tag: 'v1.0.1',
      slug: 'main',
      bundleHash: 'hash999',
      buildDate: '2026-11-16',
      generatedAt: '2026-11-16T18:00:00.000Z',
    };

    const passed = generateBuildSummary({
      ...baseOpts,
      slugResult: 'success',
      buildVerifyResult: 'success',
      packagesStatus: 'success',
      playgroundStatus: 'success',
      storybookStatus: 'success',
      deployPlaygroundResult: 'success',
      deployStorybookResult: 'success',
      deployOntologyResult: 'success',
    });

    const failed = generateBuildSummary({
      ...baseOpts,
      slugResult: 'success',
      buildVerifyResult: 'failure',
      packagesStatus: 'failure',
      playgroundStatus: 'success',
      storybookStatus: 'skipped',
      deployPlaygroundResult: 'success',
      deployStorybookResult: 'failure',
      deployOntologyResult: 'success',
    });

    expect(passed.overallStatus).toBe('passed');
    expect(failed.overallStatus).toBe('failed');
    expect(failed.failedJobs).toEqual([
      { name: 'build-verify', result: 'failure' },
      { name: 'deploy-storybook', result: 'failure' },
    ]);

    // Same top-level keys, same artifact paths, same commit & testing scope data
    expect(Object.keys(failed)).toEqual(Object.keys(passed));
    expect(failed.artifacts).toEqual(passed.artifacts);
    expect(failed.lastReleaseCommit).toEqual(passed.lastReleaseCommit);
    expect(failed.builtCommit).toEqual(passed.builtCommit);
    expect(failed.gitCommands).toEqual(passed.gitCommands);
    expect(failed.changes).toEqual(passed.changes);
    expect(failed.testingScope).toEqual(passed.testingScope);

    const passedMd = renderBuildSummaryMarkdown(passed);
    const failedMd = renderBuildSummaryMarkdown(failed);
    expect(passedMd).toContain('# Build Summary — PASSED');
    expect(passedMd).toContain('### Non-Passing Jobs');
    expect(passedMd).toContain('None — all required jobs passed.');
    expect(failedMd).toContain('# Build Summary — FAILED');
    expect(failedMd).toContain('### Non-Passing Jobs');
    expect(failedMd).toContain('\ngit diff ');
  });

  it('falls back to root commit when no release tag exists and writes files + GITHUB_OUTPUT', () => {
    const rootSha = writeAndCommit(tmpDir, { 'README.md': 'hello\n' }, 'initial commit');
    const headSha = writeAndCommit(tmpDir, { 'scripts/helper.mjs': 'console.log(1);\n' }, 'feat: add helper');

    const outDir = path.join(tmpDir, 'out');
    const ghOut = path.join(tmpDir, 'github_output.txt');
    fs.writeFileSync(ghOut, '', 'utf8');

    const proc = Bun.spawnSync(
      [
        'node',
        CLI,
        '--out-dir',
        outDir,
        '--slug-result',
        'success',
        '--build-verify-result',
        'success',
        '--deploy-playground-result',
        'success',
        '--deploy-storybook-result',
        'success',
      ],
      {
        cwd: tmpDir,
        env: { ...process.env, GITHUB_OUTPUT: ghOut },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    expect(proc.exitCode).toBe(0);
    const mdPath = path.join(outDir, 'build-summary.md');
    const jsonPath = path.join(outDir, 'build-summary.json');
    expect(fs.existsSync(mdPath)).toBe(true);
    expect(fs.existsSync(jsonPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(parsed.lastReleaseCommit.tag).toBeNull();
    expect(parsed.lastReleaseCommit.isRootFallback).toBe(true);
    expect(parsed.lastReleaseCommit.sha).toBe(rootSha);
    expect(parsed.builtCommit.sha).toBe(headSha);
    expect(parsed.testingScope.scopes.map((s) => s.scope)).toContain('validation-scripts');

    const ghOutputContent = fs.readFileSync(ghOut, 'utf8');
    expect(ghOutputContent).toContain(`released-sha=${rootSha}`);
    expect(ghOutputContent).toContain(`built-sha=${headSha}`);
    expect(ghOutputContent).toContain('overall-status=passed');
    expect(ghOutputContent).toContain('build-summary.md');
  });
});
