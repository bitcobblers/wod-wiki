// Pin public build settings so developer .env values cannot enter the package.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const PLAYGROUND = join(ROOT, 'apps', 'playground')
const TOOLS_WEB = join(ROOT, 'packages', 'tools', 'dist', 'web')

const CLEAN_ENV = {
  ...process.env,
  VITE_BASE_PATH: '',
  VITE_API_URL: '',
  VITE_STORAGE: '',
}

function run(script: string): void {
  const res = spawnSync(process.execPath, ['run', '--filter', '@bitcobblers/wod-wiki-playground', script], {
    cwd: ROOT,
    stdio: 'inherit',
    env: CLEAN_ENV,
  })
  if (res.status !== 0) process.exit(res.status ?? 1)
}

function copyFiltered(src: string, dest: string): void {
  if (!existsSync(join(src, 'index.html'))) {
    console.error(`[build-cli-assets] missing build output: ${src}/index.html`)
    process.exit(1)
  }
  cpSync(src, dest, {
    recursive: true,
    filter: (from) => {
      const rel = from.slice(src.length + 1)
      if (!rel) return true
      if (rel.endsWith('.map')) return false
      if (rel === '404.html') return false // GitHub Pages recovery shell
      if (rel.endsWith('/index.html')) return false // generated SEO deep-link shells
      return true
    },
  })
}

run('build:api')
run('build')

rmSync(join(TOOLS_WEB, 'server'), { recursive: true, force: true })
rmSync(join(TOOLS_WEB, 'playground'), { recursive: true, force: true })
copyFiltered(join(PLAYGROUND, 'dist-api'), join(TOOLS_WEB, 'server'))
copyFiltered(join(PLAYGROUND, 'dist'), join(TOOLS_WEB, 'playground'))
process.stdout.write('[build-cli-assets] staged dist/web/server (API) and dist/web/playground (IndexedDB)\n')
