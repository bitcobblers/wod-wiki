// Version Stamping Script for @bitcobblers/wod-wiki-* monorepo
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

type SemverBump = 'patch' | 'minor' | 'major';

interface PackageManifest extends Record<string, unknown> {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function isSemverBump(value: string): value is SemverBump {
  return value === 'patch' || value === 'minor' || value === 'major';
}

function parseArgs(): { version?: string; bump?: SemverBump; prerelease?: string | boolean } {
  const args = process.argv.slice(2);
  const parsed: { version?: string; bump?: SemverBump; prerelease?: string | boolean } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version' && args[i + 1]) {
      parsed.version = args[++i];
    } else if (args[i] === '--bump' && args[i + 1]) {
      const next = args[++i];
      if (!isSemverBump(next)) {
        throw new Error(`Invalid --bump value: ${next} (expected patch, minor, or major)`);
      }
      parsed.bump = next;
    } else if (args[i] === '--prerelease') {
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        parsed.prerelease = args[++i];
      } else {
        parsed.prerelease = true;
      }
    }
  }

  return parsed;
}

function bumpSemver(base: string, bump: 'patch' | 'minor' | 'major'): string {
  const cleanBase = base.split('-')[0];
  const parts = cleanBase.split('.').map((p) => parseInt(p, 10));
  if (parts.length < 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver to bump: ${base}`);
  }
  let [major, minor, patch] = parts;
  if (bump === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === 'minor') {
    minor += 1;
    patch = 0;
  } else if (bump === 'patch') {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

const rootDir = path.resolve(__dirname, '..');
const rootPkgPath = path.join(rootDir, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8')) as PackageManifest;

const cliArgs = parseArgs();
const gitSha = getGitSha();
const buildTime = new Date().toISOString();

let targetVersion = cliArgs.version || rootPkg.version || '0.1.0';

if (cliArgs.bump) {
  targetVersion = bumpSemver(targetVersion, cliArgs.bump);
}

if (cliArgs.prerelease) {
  const tag = typeof cliArgs.prerelease === 'string' ? cliArgs.prerelease : 'next';
  const timestamp = Math.floor(Date.now() / 1000);
  targetVersion = `${targetVersion}-${tag}.${timestamp}.${gitSha}`;
}

console.log(`\x1b[36m[stamp-version]\x1b[0m Setting version to \x1b[32m${targetVersion}\x1b[0m (SHA: ${gitSha}, Time: ${buildTime})`);

rootPkg.version = targetVersion;
fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');

const pkgDirs: string[] = [];
for (const base of ['packages', 'apps']) {
  const fullBase = path.join(rootDir, base);
  if (fs.existsSync(fullBase)) {
    for (const entry of fs.readdirSync(fullBase, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        pkgDirs.push(path.join(fullBase, entry.name));
      }
    }
  }
}

for (const pkgDir of pkgDirs) {
  const pPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pPath)) continue;

  const pkgJson = JSON.parse(fs.readFileSync(pPath, 'utf-8')) as PackageManifest;
  pkgJson.version = targetVersion;

  for (const depType of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const deps = pkgJson[depType];
    if (deps) {
      for (const depName of Object.keys(deps)) {
        if (depName.startsWith('@bitcobblers/wod-wiki-')) {
          deps[depName] = `^${targetVersion}`;
        }
      }
    }
  }

  fs.writeFileSync(pPath, JSON.stringify(pkgJson, null, 2) + '\n');

  const srcDir = path.join(pkgDir, 'src');
  if (fs.existsSync(srcDir)) {
    const versionTsPath = path.join(srcDir, 'version.ts');
    const versionTsContent = `/**
 * Auto-generated build version metadata.
 * Do not edit directly; updated by scripts/stamp-version.ts
 */
export const VERSION = '${targetVersion}';
export const GIT_SHA = '${gitSha}';
export const BUILD_TIME = '${buildTime}';
export const SEMVER = {
  version: '${targetVersion}',
  gitSha: '${gitSha}',
  buildTime: '${buildTime}',
} as const;
`;
    fs.writeFileSync(versionTsPath, versionTsContent);
    console.log(`  Updated ${path.relative(rootDir, pPath)} and ${path.relative(rootDir, versionTsPath)}`);
  }
}

console.log(`\x1b[32m✔ Version stamped successfully.\x1b[0m`);
