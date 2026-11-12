/**
 * Regenerate the app-served and `.agents/skills` copies of this repo's agent skills,
 * and verify that repo-relative paths cited in repo-mirrored skills exist on disk.
 *
 * Canonical source: `skills/<name>/SKILL.md` — what `wod skills install` copies
 * into a project and what `npx skills add bitcobblers/wod-wiki` publishes. The
 * playground only serves static files, so the in-app download button needs a
 * copy under `apps/playground/public/`; repo-native development skills also
 * mirror into `.agents/skills/<name>/` so local coding agents auto-discover them.
 *
 *   bun scripts/sync-skills.ts           # write the copies & verify skill paths
 *   bun scripts/sync-skills.ts --check   # exit 1 when a copy has drifted or a path is broken
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SKILLS = join(ROOT, 'skills')

/** skill name -> path served by the playground/CLI server (public-dir relative). */
const SERVED: Record<string, string> = {
  'wod-extraction': 'apps/playground/public/ai-skills/parse.md',
  'wod-cli': 'apps/playground/public/ai-skills/cli.md',
  'wod-wql': 'apps/playground/public/ai-skills/wql.md',
  'wod-agent-parity': 'apps/playground/public/ai-skills/agent-parity.md',
}

/** Repo-native skills mirrored whole into `.agents/skills/<name>/` for local agent CLIs. */
const AGENT_MIRRORED = ['wod-wiki-testing', 'wod-cli', 'wod-wql', 'wod-agent-parity'] as const

const REPO_PATH_PREFIX = /^(?:packages|apps|e2e|docs|scripts)\/[A-Za-z0-9._/-]+$/

const check = process.argv.includes('--check')
let drift = 0

function syncFile(sourcePath: string, targetRelPath: string): void {
  const source = readFileSync(sourcePath, 'utf8')
  const targetPath = join(ROOT, targetRelPath)
  let current: string | undefined
  try {
    current = readFileSync(targetPath, 'utf8')
  } catch {
    current = undefined
  }
  if (current === source) {
    process.stdout.write(`[sync-skills] ${targetRelPath} up to date\n`)
    return
  }
  if (check) {
    drift++
    console.error(`[sync-skills] ${targetRelPath} is stale — run: bun scripts/sync-skills.ts`)
    return
  }
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, source)
  process.stdout.write(`[sync-skills] wrote ${targetRelPath}\n`)
}

function walkFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(full))
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files.sort()
}

function verifyCitedRepoPaths(markdownFile: string): void {
  const content = readFileSync(markdownFile, 'utf8')
  const codeSpanRe = /`([^`\n]+)`/g
  let match: RegExpExecArray | null
  while ((match = codeSpanRe.exec(content)) !== null) {
    const token = match[1]!.trim()
    if (token.includes('<') || token.includes('*') || token.includes('{')) continue
    if (!REPO_PATH_PREFIX.test(token)) continue
    const abs = join(ROOT, token)
    if (!existsSync(abs)) {
      drift++
      console.error(
        `[sync-skills] ${relative(ROOT, markdownFile)} cites missing repo path: ${token}`,
      )
    }
  }
}

const skillEntries = readdirSync(SKILLS).filter((name) =>
  statSync(join(SKILLS, name)).isDirectory(),
)

for (const name of skillEntries) {
  const target = SERVED[name]
  if (!target) continue
  syncFile(join(SKILLS, name, 'SKILL.md'), target)
}

for (const name of Object.keys(SERVED)) {
  if (!skillEntries.includes(name)) {
    drift++
    console.error(`[sync-skills] skills/${name}/SKILL.md is missing (declared in SERVED)`)
  }
}

for (const name of AGENT_MIRRORED) {
  const srcDir = join(SKILLS, name)
  if (!existsSync(join(srcDir, 'SKILL.md'))) {
    drift++
    console.error(`[sync-skills] skills/${name}/SKILL.md is missing (declared in AGENT_MIRRORED)`)
    continue
  }
  for (const file of walkFiles(srcDir)) {
    const relInsideSkill = relative(srcDir, file)
    syncFile(file, join('.agents', 'skills', name, relInsideSkill))
    if (file.endsWith('.md')) {
      verifyCitedRepoPaths(file)
    }
  }
}

if (drift > 0) process.exit(1)
