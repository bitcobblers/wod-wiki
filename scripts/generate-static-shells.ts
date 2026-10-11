/**
 * generate-static-shells — GitHub Pages deep-link recovery (#709).
 *
 * GitHub Pages serves a hard 404 for any path without its own file, so a
 * shared links like https://wod.wiki/guide/syntax or a collection page
 * unfurlers/crawlers/link-checkers would otherwise see 404 (the sessionStorage
 * 404.html fallback only rescues JS browsers). This post-build step copies the
 * built SPA shell into a nested index.html per *finite* public content route
 * (canvas/guide pages via frontmatter `route:`, collection pages as
 * `/collections/<slug>`), injecting route-specific `<title>`, description, and
 * Open Graph / canonical metadata so those paths return 200 with a meaningful
 * preview. Dynamic routes (`/journal/:date`, `/playground/:id`, custom
 * efforts) cannot be enumerated and still recover via 404.html.
 *
 * Metadata-only shells by locked design (2026-07-22): no prerendered route
 * content; one static branded og:image on every shell.
 *
 * Runs after `vite build` has produced playground/dist/index.html (chained in
 * the `build:app` script). Idempotent.
 */
import { Glob } from 'bun'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ROOT = join(import.meta.dir, '..')
// The corpus lives in the sibling wod-wiki-seed repo; this post-build step
// reads it from the synced seed artifact (sync-seed runs before vite build).
const SEED_CHUNKS = join(ROOT, 'apps', 'playground', 'public', 'seed')
const DIST = join(ROOT, 'apps', 'playground', 'dist')
const SITE_URL = (process.env.SITE_URL ?? 'https://wod.wiki').replace(/\/+$/, '')
const OG_IMAGE = `${SITE_URL}/images/wod-wiki-logo-light.png`

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Parse a leading frontmatter block (`---\n...\n---`) into a meta map + body. */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {}
  if (!raw.startsWith('---')) return { meta, body: raw }
  const end = raw.indexOf('\n---', 3)
  const head = end === -1 ? raw.slice(3) : raw.slice(3, end).trim()
  for (const line of head.split('\n')) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  const body = end === -1 ? '' : raw.slice(end + 4)
  return { meta, body }
}

function firstTitle(body: string): string | null {
  const m = body.match(/^\s*#+\s+(.+)$/m)
  if (!m) return null
  const t = m[1]!.replace(/\{.*$/, '').trim()
  return t || null
}

function firstDescription(body: string): string | null {
  let started = false
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (/^#/.test(t)) { started = true; continue }
    if (!started || !t) continue
    if (t.startsWith('```') || t.startsWith('{{') || /^[-*_>]/.test(t)) continue
    return t.replace(/[*_`]/g, '').slice(0, 200)
  }
  return null
}

/** Build the shell for one route from the built index.html template. */
function buildShell(template: string, title: string, desc: string, route: string): string {
  const pageTitle = `${title} — Wod.Wiki`
  const meta =
    `<meta name="description" content="${escapeHtml(desc)}" />\n` +
    `    <link rel="canonical" href="${SITE_URL}${route}" />\n` +
    `    <meta property="og:type" content="website" />\n` +
    `    <meta property="og:site_name" content="Wod.Wiki" />\n` +
    `    <meta property="og:title" content="${escapeHtml(title)}" />\n` +
    `    <meta property="og:description" content="${escapeHtml(desc)}" />\n` +
    `    <meta property="og:url" content="${SITE_URL}${route}" />\n` +
    `    <meta property="og:image" content="${OG_IMAGE}" />\n` +
    `    <meta name="twitter:card" content="summary" />\n  `
  return template
    .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(pageTitle)}</title>`)
    .replace('</head>', `${meta}</head>`)
}

interface SeedRowRef {
  path: string
  content: string
}

/** Read every `{path, content}` row from the content-hashed seed note chunks matching a glob (e.g. `canvas.*.json`). */
function* readChunkRows(chunkGlob: string): Generator<SeedRowRef> {
  for (const file of new Glob(`*/chunks/${chunkGlob}`).scanSync(SEED_CHUNKS)) {
    const rows = JSON.parse(readFileSync(join(SEED_CHUNKS, file), 'utf8')) as SeedRowRef[]
    yield* rows
  }
}

/** Collect { route, title, desc } for every finite public content route. */
function collectRoutes(): { route: string; title: string; desc: string }[] {
  const out: { route: string; title: string; desc: string }[] = []
  const defaultDesc = 'Query and explore your training data on Wod.Wiki.'

  // Canvas/guide pages: frontmatter `route:` + `template: canvas` (the whole
  // `canvas` chunk is the markdown/canvas corpus).
  for (const { content } of readChunkRows('canvas.*.json')) {
    const { meta, body } = parseFrontmatter(content)
    if (String(meta['template']) !== 'canvas' || !meta['route']) continue
    const route = meta['route'].startsWith('/') ? meta['route'] : `/${meta['route']}`
    const title = firstTitle(body) ?? 'Wod.Wiki guide'
    const desc = firstDescription(body) ?? defaultDesc
    out.push({ route, title, desc })
  }

  // Collection pages: markdown/collections/<slug>/README.md → /collections/<slug>
  // (the root collections README is a corpus overview, not a catalog page).
  for (const { path, content } of readChunkRows('collection.*.json')) {
    const parts = path.split('/')
    if (parts.length !== 4 || !parts[3]!.toLowerCase().endsWith('readme.md')) continue
    const slug = parts[2]!
    const { body } = parseFrontmatter(content)
    const title = firstTitle(body) ?? slug
    const desc = firstDescription(body) ?? defaultDesc
    out.push({ route: `/collections/${slug}`, title, desc })
  }

  return out
}

function main(): void {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.warn('[static-shells] playground/dist/index.html missing — did vite build run first? Skipping.')
    return
  }
  const template = readFileSync(join(DIST, 'index.html'), 'utf8')
  const routes = collectRoutes()
  let written = 0
  for (const { route, title, desc } of routes) {
    if (route === '/' || route === '') continue
    const rel = route.replace(/^\/+/, '')
    const file = join(DIST, rel, 'index.html')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, buildShell(template, title, desc, route))
    written++
  }
  console.log(`[static-shells] wrote ${written} route shells (template source: playground/dist/index.html)`)
}

main()
