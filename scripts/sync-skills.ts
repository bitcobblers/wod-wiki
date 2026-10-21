/**
 * Regenerate the app-served copies of this repo's agent skills.
 *
 * Canonical source: `skills/<name>/SKILL.md` — what `wod skills install` copies
 * into a project and what `npx skills add bitcobblers/wod-wiki` publishes. The
 * playground only serves static files, so the in-app download button needs a
 * copy under `apps/playground/public/`; that copy is generated here.
 *
 *   bun scripts/sync-skills.ts           # write the copies
 *   bun scripts/sync-skills.ts --check   # exit 1 when a copy has drifted
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SKILLS = join(ROOT, 'skills')

/** skill name → path served by the playground/CLI server (public-dir relative). */
const SERVED: Record<string, string> = {
  'wod-extraction': 'apps/playground/public/ai-skills/parse.md',
}

const check = process.argv.includes('--check')
let drift = 0

for (const name of readdirSync(SKILLS)) {
  const target = SERVED[name]
  if (!target) continue
  const source = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8')
  const path = join(ROOT, target)
  let current: string | undefined
  try {
    current = readFileSync(path, 'utf8')
  } catch {
    current = undefined
  }
  if (current === source) {
    process.stdout.write(`[sync-skills] ${target} up to date\n`)
    continue
  }
  if (check) {
    drift++
    console.error(`[sync-skills] ${target} is stale — run: bun scripts/sync-skills.ts`)
    continue
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source)
  process.stdout.write(`[sync-skills] wrote ${target}\n`)
}

const missing = Object.keys(SERVED).filter((name) => !readdirSync(SKILLS).includes(name))
for (const name of missing) {
  drift++
  console.error(`[sync-skills] skills/${name}/SKILL.md is missing (declared in SERVED)`)
}

if (drift > 0) process.exit(1)
