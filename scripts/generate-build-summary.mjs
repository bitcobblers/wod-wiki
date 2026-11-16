#!/usr/bin/env node
// Generate build-summary.md and build-summary.json comparing the built commit
// against the last release commit (latest vX.Y.Z tag, or root commit fallback).
// Produces the exact same output structure for both passed and failed builds.
//
// Usage:
//   node scripts/generate-build-summary.mjs [options]

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function tryGit(args, cwd = process.cwd()) {
  try {
    return git(args, cwd);
  } catch {
    return '';
  }
}

function normalizeStatus(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return 'unknown';
  return v;
}

function findLatestReleaseTag(cwd) {
  const raw = tryGit(
    ['for-each-ref', 'refs/tags', '--sort=-v:refname', '--format=%(refname:short)'],
    cwd,
  );
  if (!raw) return null;
  const tag = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^v?\d+\.\d+(\.\d+)?$/.test(line));
  return tag || null;
}

function getCommitDetails(ref, cwd) {
  const sha = git(['rev-parse', ref], cwd).trim();
  const shortSha = git(['rev-parse', '--short=7', sha], cwd).trim();
  const raw = git(['show', '-s', '--format=%cI%x09%an%x09%s', sha], cwd).trim();
  const [date = '', author = '', ...subjectParts] = raw.split('\t');
  return {
    sha,
    shortSha,
    date,
    author,
    subject: subjectParts.join('\t'),
  };
}

function classifyArea(filePath) {
  const parts = filePath.split('/');
  if (parts[0] === 'packages' && parts[1]) return `packages/${parts[1]}`;
  if (parts[0] === 'apps' && parts[1]) return `apps/${parts[1]}`;
  if (parts[0] === 'e2e') return 'e2e';
  if (parts[0] === 'ontology') return 'ontology';
  if (parts[0] === 'markdown') return 'markdown';
  if (parts[0] === 'scripts') return 'scripts';
  if (parts[0] === '.github') return '.github';
  if (parts[0] === 'docs') return 'docs';
  return 'root';
}

function parseNameStatus(raw) {
  if (!raw.trim()) return [];
  const files = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const statusCode = cols[0] ?? '';
    const statusLetter = statusCode[0] || 'M';
    if (statusLetter === 'R' || statusLetter === 'C') {
      files.push({
        status: statusCode,
        oldPath: cols[1] ?? '',
        path: cols[2] ?? cols[1] ?? '',
      });
    } else {
      files.push({
        status: statusCode,
        path: cols[1] ?? '',
      });
    }
  }
  return files;
}

function parseCommits(raw) {
  if (!raw.trim()) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', shortSha = '', date = '', author = '', ...subjectParts] = line.split('\t');
      return {
        sha,
        shortSha,
        date,
        author,
        subject: subjectParts.join('\t'),
      };
    });
}

function buildAreaBreakdown(changedFiles) {
  const map = new Map();
  for (const file of changedFiles) {
    const area = classifyArea(file.path);
    let entry = map.get(area);
    if (!entry) {
      entry = { area, total: 0, added: 0, modified: 0, deleted: 0, renamed: 0, files: [] };
      map.set(area, entry);
    }
    entry.total += 1;
    const letter = file.status[0];
    if (letter === 'A') entry.added += 1;
    else if (letter === 'D') entry.deleted += 1;
    else if (letter === 'R' || letter === 'C') entry.renamed += 1;
    else entry.modified += 1;
    entry.files.push(file.path);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.area.localeCompare(b.area));
}

function deriveTestingScope(changedFiles, areaBreakdown) {
  const areas = new Set(areaBreakdown.map((a) => a.area));
  const touchedPackageAreas = [...areas].filter((a) => a.startsWith('packages/'));
  const scopes = [];

  if (touchedPackageAreas.length > 0) {
    scopes.push({
      scope: 'packages-unit-and-typecheck',
      reason: `Changed packages: ${touchedPackageAreas.join(', ')}`,
      commands: ['bun run test:package', 'bun run typecheck:package'],
    });
  }

  if (
    areas.has('packages/engine') ||
    areas.has('packages/storage') ||
    areas.has('packages/tools') ||
    areas.has('apps/api')
  ) {
    scopes.push({
      scope: 'api-server-and-sqlite',
      reason: 'Server, storage, engine, or CLI/tools changes detected',
      commands: ['bun run check:server', 'bun run test:e2e:api'],
    });
  }

  if (
    areas.has('apps/playground') ||
    areas.has('packages/ui') ||
    areas.has('packages/core') ||
    areas.has('packages/lang') ||
    areas.has('packages/wql') ||
    areas.has('packages/engine') ||
    areas.has('e2e')
  ) {
    scopes.push({
      scope: 'playground-e2e',
      reason: 'Playground UI, runtime/language packages, or E2E suite changed',
      commands: ['bun run test:e2e:preview'],
    });
  }

  if (areas.has('apps/storybook') || areas.has('packages/ui') || areas.has('apps/playground')) {
    scopes.push({
      scope: 'storybook',
      reason: 'UI components, Storybook stories, or Playground components changed',
      commands: ['bun run test:storybook'],
    });
  }

  if (areas.has('apps/playground') || areas.has('packages/ui')) {
    scopes.push({
      scope: 'cast-receiver',
      reason: 'Playground or shared UI changed; verify Cast receiver CSS compatibility',
      commands: ['bun run check:receiver-css'],
    });
  }

  if (areas.has('markdown')) {
    scopes.push({
      scope: 'seed-corpus',
      reason: 'Seed markdown corpus changed',
      commands: ['bun run test:seed'],
    });
  }

  if (areas.has('ontology')) {
    scopes.push({
      scope: 'ontology',
      reason: 'Ontology schema or generated artifacts changed',
      commands: ['bun run ontology:validate'],
    });
  }

  if (areas.has('scripts')) {
    scopes.push({
      scope: 'validation-scripts',
      reason: 'Repository scripts changed',
      commands: ['bun run test:validation-scripts'],
    });
  }

  if (areas.has('.github')) {
    scopes.push({
      scope: 'ci-workflows',
      reason: 'GitHub Actions workflows or prompts changed',
      commands: ['Review workflow run logs and summary outputs'],
    });
  }

  const touchedE2eFiles = changedFiles
    .map((f) => f.path)
    .filter((p) => p.startsWith('e2e/'));

  const touchedE2eDomains = [...new Set(
    touchedE2eFiles
      .map((p) => {
        const match = /^e2e\/specs\/([^/]+)\//.exec(p);
        return match ? match[1] : null;
      })
      .filter(Boolean),
  )].sort();

  return {
    scopes,
    touchedE2eFiles,
    touchedE2eDomains,
  };
}

export function generateBuildSummary(options = {}) {
  const cwd = options.cwd ?? process.cwd();

  let releaseTag = null;
  let isRootFallback = false;
  let releasedRef = options.base;

  if (!releasedRef) {
    releaseTag = findLatestReleaseTag(cwd);
    if (releaseTag) {
      releasedRef = releaseTag;
    } else {
      const roots = git(['rev-list', '--max-parents=0', 'HEAD'], cwd)
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      releasedRef = roots[roots.length - 1];
      isRootFallback = true;
    }
  } else {
    const exactTag = tryGit(['describe', '--tags', '--exact-match', releasedRef], cwd).trim();
    if (exactTag) releaseTag = exactTag;
  }

  const headRef = options.head || 'HEAD';
  const lastReleaseCommit = {
    tag: releaseTag,
    isRootFallback,
    ...getCommitDetails(releasedRef, cwd),
  };

  const builtCommitBase = getCommitDetails(headRef, cwd);
  const builtRefName =
    options.ref ||
    process.env.GITHUB_REF_NAME ||
    tryGit(['rev-parse', '--abbrev-ref', headRef], cwd).trim() ||
    'HEAD';

  const builtCommit = {
    ref: builtRefName,
    ...builtCommitBase,
  };

  const range = `${lastReleaseCommit.sha}..${builtCommit.sha}`;
  const commitsRaw = tryGit(['log', '--format=%H%x09%h%x09%cI%x09%an%x09%s', range], cwd);
  const commits = parseCommits(commitsRaw);

  const nameStatusRaw = tryGit(['diff', '--name-status', '-M', range], cwd);
  const changedFiles = parseNameStatus(nameStatusRaw);
  const diffStat = tryGit(['diff', '--stat', range], cwd);

  const areaBreakdown = buildAreaBreakdown(changedFiles);
  const testingScope = deriveTestingScope(changedFiles, areaBreakdown);

  const jobs = {
    slug: {
      result: normalizeStatus(options.slugResult),
    },
    buildVerify: {
      result: normalizeStatus(options.buildVerifyResult),
      packagesStatus: normalizeStatus(options.packagesStatus),
      playgroundStatus: normalizeStatus(options.playgroundStatus),
      storybookStatus: normalizeStatus(options.storybookStatus),
    },
    deployPlayground: {
      result: normalizeStatus(options.deployPlaygroundResult),
    },
    deployStorybook: {
      result: normalizeStatus(options.deployStorybookResult),
    },
    deployOntology: {
      result: normalizeStatus(options.deployOntologyResult),
      nonBlocking: true,
    },
  };

  const requiredJobs = [
    ['slug', jobs.slug.result],
    ['build-verify', jobs.buildVerify.result],
    ['deploy-playground', jobs.deployPlayground.result],
    ['deploy-storybook', jobs.deployStorybook.result],
  ];

  const failedJobs = requiredJobs
    .filter(([, result]) => result !== 'success')
    .map(([name, result]) => ({ name, result }));

  if (jobs.deployOntology.result !== 'success' && jobs.deployOntology.result !== 'unknown') {
    failedJobs.push({ name: 'deploy-ontology (non-blocking)', result: jobs.deployOntology.result });
  }

  const overallStatus = requiredJobs.every(([, result]) => result === 'success') ? 'passed' : 'failed';

  const slug = options.slug || 'main';
  const buildDate = options.buildDate || new Date().toISOString().slice(0, 10);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const folder = `${buildDate}-${builtCommit.shortSha}`;
  const s3Bucket = options.s3Bucket || 'build-changes';
  const s3Prefix = `s3://${s3Bucket}/${folder}`;

  const repository = options.repository || process.env.GITHUB_REPOSITORY || 'bitcobblers/wod-wiki';
  const serverUrl = options.serverUrl || process.env.GITHUB_SERVER_URL || 'https://github.com';
  const runId = options.runId || process.env.GITHUB_RUN_ID || '';
  const runNumber = options.runNumber || process.env.GITHUB_RUN_NUMBER || '';
  const runUrl = options.runUrl || (runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : '');

  const summary = {
    schemaVersion: 1,
    generatedAt,
    overallStatus,
    run: {
      repository,
      workflow: options.workflow || process.env.GITHUB_WORKFLOW || 'Build & Stage – Main',
      event: options.event || process.env.GITHUB_EVENT_NAME || '',
      actor: options.actor || process.env.GITHUB_ACTOR || '',
      runId,
      runNumber,
      runUrl,
      slug,
      version: options.version || '',
      tag: options.tag || '',
      bundleHash: options.bundleHash || '',
    },
    stagingUrls: {
      playground: `https://${slug}.preview.wod.wiki`,
      storybook: `https://${slug}.story.wod.wiki`,
      ontology: `https://${slug}.preview.wod.wiki/ontology/`,
    },
    jobs,
    failedJobs,
    lastReleaseCommit,
    builtCommit,
    gitCommands: {
      range,
      diff: `git diff ${range}`,
      diffStat: `git diff --stat ${range}`,
      diffNameStatus: `git diff --name-status ${range}`,
      log: `git log --oneline ${range}`,
      fetchAndDiff: `git fetch origin --tags && git diff ${range}`,
      ...(lastReleaseCommit.tag ? { diffByTag: `git diff ${lastReleaseCommit.tag}..${builtCommit.sha}` } : {}),
    },
    changes: {
      commitCount: commits.length,
      changedFileCount: changedFiles.length,
      diffStat,
      commits,
      areaBreakdown,
      changedFiles,
    },
    testingScope,
    artifacts: {
      folder,
      s3Prefix,
      summaryMarkdown: `${s3Prefix}/build-summary.md`,
      summaryJson: `${s3Prefix}/build-summary.json`,
    },
  };

  return summary;
}

export function renderBuildSummaryMarkdown(summary) {
  const {
    overallStatus,
    generatedAt,
    run,
    stagingUrls,
    jobs,
    failedJobs,
    lastReleaseCommit,
    builtCommit,
    gitCommands,
    changes,
    testingScope,
    artifacts,
  } = summary;

  const statusBadge = overallStatus === 'passed' ? 'PASSED' : 'FAILED';
  const lines = [
    `# Build Summary — ${statusBadge}`,
    '',
    `- **Generated at**: \`${generatedAt}\``,
    `- **Overall status**: \`${overallStatus}\``,
    `- **Version / Tag**: \`${run.version || 'n/a'}\` (\`${run.tag || 'n/a'}\`)`,
    `- **Branch / Slug**: \`${builtCommit.ref}\` (\`${run.slug}\`)`,
    `- **Bundle hash**: \`${run.bundleHash || 'n/a'}\``,
    `- **Workflow**: ${run.workflow}${run.runNumber ? ` #${run.runNumber}` : ''}${run.runUrl ? ` ([run](${run.runUrl}))` : ''}`,
    `- **S3 folder**: \`${artifacts.s3Prefix}\``,
    '',
    '## Run Jobs',
    '',
    '| Job | Status | Details |',
    '| --- | --- | --- |',
    `| slug | \`${jobs.slug.result}\` | version=\`${run.version || 'n/a'}\` |`,
    `| build-verify | \`${jobs.buildVerify.result}\` | packages=\`${jobs.buildVerify.packagesStatus}\`, playground=\`${jobs.buildVerify.playgroundStatus}\`, storybook=\`${jobs.buildVerify.storybookStatus}\` |`,
    `| deploy-playground | \`${jobs.deployPlayground.result}\` | ${stagingUrls.playground} |`,
    `| deploy-storybook | \`${jobs.deployStorybook.result}\` | ${stagingUrls.storybook} |`,
    `| deploy-ontology (non-blocking) | \`${jobs.deployOntology.result}\` | ${stagingUrls.ontology} |`,
    '',
    '### Non-Passing Jobs',
    '',
    ...(failedJobs.length > 0
      ? failedJobs.map((j) => `- **${j.name}**: \`${j.result}\``)
      : ['None — all required jobs passed.']),
    '',
  ];

  lines.push(
    '## Commits',
    '',
    '| Role | Tag / Ref | Full SHA | Short SHA | Date | Author | Subject |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    `| Last Release | \`${lastReleaseCommit.tag || (lastReleaseCommit.isRootFallback ? 'root-commit' : 'custom-base')}\` | \`${lastReleaseCommit.sha}\` | \`${lastReleaseCommit.shortSha}\` | \`${lastReleaseCommit.date}\` | ${lastReleaseCommit.author} | ${lastReleaseCommit.subject} |`,
    `| Built Commit | \`${builtCommit.ref}\` | \`${builtCommit.sha}\` | \`${builtCommit.shortSha}\` | \`${builtCommit.date}\` | ${builtCommit.author} | ${builtCommit.subject} |`,
    '',
    '## Git Diff Commands',
    '',
    '```bash',
    gitCommands.fetchAndDiff,
    gitCommands.diff,
    gitCommands.diffStat,
    gitCommands.diffNameStatus,
    gitCommands.log,
    ...(gitCommands.diffByTag ? [gitCommands.diffByTag] : []),
    '```',
    '',
    '## Testing Scope',
    '',
    `- **Commits since last release**: ${changes.commitCount}`,
    `- **Changed files**: ${changes.changedFileCount}`,
    '',
  );

  if (testingScope.scopes.length > 0) {
    lines.push(
      '### Recommended Test Scopes',
      '',
      '| Scope | Reason | Suggested Commands |',
      '| --- | --- | --- |',
      ...testingScope.scopes.map(
        (s) => `| \`${s.scope}\` | ${s.reason} | ${s.commands.map((c) => `\`${c}\``).join(', ')} |`,
      ),
      '',
    );
  } else {
    lines.push('No affected code areas detected between release and built commit.', '');
  }

  if (testingScope.touchedE2eDomains.length > 0 || testingScope.touchedE2eFiles.length > 0) {
    lines.push('### Touched E2E Areas', '');
    if (testingScope.touchedE2eDomains.length > 0) {
      lines.push(`- **Domains**: ${testingScope.touchedE2eDomains.map((d) => `\`${d}\``).join(', ')}`);
    }
    if (testingScope.touchedE2eFiles.length > 0) {
      lines.push(`- **E2E files**: ${testingScope.touchedE2eFiles.map((f) => `\`${f}\``).join(', ')}`);
    }
    lines.push('');
  }

  lines.push('### Affected Workspaces & Areas', '');
  if (changes.areaBreakdown.length > 0) {
    lines.push(
      '| Area | Total | Added | Modified | Deleted | Renamed |',
      '| --- | ---: | ---: | ---: | ---: | ---: |',
      ...changes.areaBreakdown.map(
        (a) => `| \`${a.area}\` | ${a.total} | ${a.added} | ${a.modified} | ${a.deleted} | ${a.renamed} |`,
      ),
      '',
    );
  } else {
    lines.push('No file changes detected.', '');
  }

  if (changes.diffStat) {
    lines.push('### Diff Stat', '', '```text', changes.diffStat, '```', '');
  }

  lines.push('### Commits Included', '');
  if (changes.commits.length > 0) {
    lines.push(
      ...changes.commits.map((c) => `- \`${c.shortSha}\` ${c.subject} (${c.author}, ${c.date})`),
      '',
    );
  } else {
    lines.push('No commits between last release and built commit.', '');
  }

  lines.push('### Changed Files', '');
  if (changes.changedFiles.length > 0) {
    lines.push(
      ...changes.changedFiles.map((f) =>
        f.oldPath ? `- \`${f.status}\` \`${f.oldPath}\` -> \`${f.path}\`` : `- \`${f.status}\` \`${f.path}\``,
      ),
      '',
    );
  } else {
    lines.push('No changed files.', '');
  }

  return lines.join('\n');
}

function main() {
  const { values } = parseArgs({
    options: {
      'out-dir': { type: 'string', default: '.' },
      base: { type: 'string' },
      head: { type: 'string' },
      ref: { type: 'string' },
      version: { type: 'string' },
      tag: { type: 'string' },
      slug: { type: 'string' },
      'bundle-hash': { type: 'string' },
      'slug-result': { type: 'string' },
      'build-verify-result': { type: 'string' },
      'packages-status': { type: 'string' },
      'playground-status': { type: 'string' },
      'storybook-status': { type: 'string' },
      'deploy-playground-result': { type: 'string' },
      'deploy-storybook-result': { type: 'string' },
      'deploy-ontology-result': { type: 'string' },
      'run-id': { type: 'string' },
      'run-number': { type: 'string' },
      'run-url': { type: 'string' },
      workflow: { type: 'string' },
      event: { type: 'string' },
      actor: { type: 'string' },
      repo: { type: 'string' },
      's3-bucket': { type: 'string' },
    },
  });

  const summary = generateBuildSummary({
    base: values.base,
    head: values.head,
    ref: values.ref,
    version: values.version ?? process.env.BUILD_VERSION,
    tag: values.tag ?? process.env.BUILD_TAG,
    slug: values.slug ?? process.env.BUILD_SLUG,
    bundleHash: values['bundle-hash'] ?? process.env.BUNDLE_HASH,
    slugResult: values['slug-result'] ?? process.env.SLUG_RESULT,
    buildVerifyResult: values['build-verify-result'] ?? process.env.BUILD_VERIFY_RESULT,
    packagesStatus: values['packages-status'] ?? process.env.PACKAGES_STATUS,
    playgroundStatus: values['playground-status'] ?? process.env.PLAYGROUND_STATUS,
    storybookStatus: values['storybook-status'] ?? process.env.STORYBOOK_STATUS,
    deployPlaygroundResult: values['deploy-playground-result'] ?? process.env.DEPLOY_PLAYGROUND_RESULT,
    deployStorybookResult: values['deploy-storybook-result'] ?? process.env.DEPLOY_STORYBOOK_RESULT,
    deployOntologyResult: values['deploy-ontology-result'] ?? process.env.DEPLOY_ONTOLOGY_RESULT,
    runId: values['run-id'],
    runNumber: values['run-number'],
    runUrl: values['run-url'],
    workflow: values.workflow,
    event: values.event,
    actor: values.actor,
    repository: values.repo,
    s3Bucket: values['s3-bucket'],
  });

  const outDir = path.resolve(values['out-dir']);
  mkdirSync(outDir, { recursive: true });

  const mdPath = path.join(outDir, 'build-summary.md');
  const jsonPath = path.join(outDir, 'build-summary.json');

  writeFileSync(mdPath, renderBuildSummaryMarkdown(summary), 'utf8');
  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  if (process.env.GITHUB_OUTPUT) {
    const outputs = [
      `folder=${summary.artifacts.folder}`,
      `summary-md=${mdPath}`,
      `summary-json=${jsonPath}`,
      `s3-prefix=${summary.artifacts.s3Prefix}`,
      `s3-path=${summary.artifacts.summaryMarkdown}`,
      `s3-json-path=${summary.artifacts.summaryJson}`,
      `overall-status=${summary.overallStatus}`,
      `released-sha=${summary.lastReleaseCommit.sha}`,
      `built-sha=${summary.builtCommit.sha}`,
    ];
    appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
  }

  console.log(
    `Generated build summary (${summary.overallStatus}) -> ${mdPath} & ${jsonPath} (${summary.artifacts.s3Prefix})`,
  );
}

if (import.meta.main || process.argv[1]?.endsWith('generate-build-summary.mjs')) {
  main();
}
