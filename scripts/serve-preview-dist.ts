#!/usr/bin/env bun
/**
 * Static preview server for prebuilt Playground `dist/` artifacts.
 *
 * Mirrors the S3 + CloudFront routing contract used by PR previews and
 * production deploys:
 *  - Auto-detects a sub-path `VITE_BASE_PATH` (such as `/<slug>/dist/` on PR
 *    builds) from `dist/index.html` and strips that prefix on asset/seed
 *    requests so the exact deployed bundle runs at `http://127.0.0.1:4173/`.
 *  - Serves exact static files (`assets/*`, `seed/*`, `receiver-rpc.html`, …)
 *    and nested static route shells (`<route>/index.html`).
 *  - Returns `404` for missing asset/data paths (anything with a file
 *    extension) and falls back to `dist/index.html` for SPA client routes.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

let dirArg = 'apps/playground/dist';
let port = Number(process.env.PORT || 4173);
let host = process.env.HOST || '127.0.0.1';
let baseOverride = process.env.PREVIEW_BASE_PATH || '';

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--dir' && i + 1 < args.length) {
    dirArg = args[++i]!;
  } else if (arg === '--port' && i + 1 < args.length) {
    port = Number(args[++i]);
  } else if (arg === '--host' && i + 1 < args.length) {
    host = args[++i]!;
  } else if (arg === '--base' && i + 1 < args.length) {
    baseOverride = args[++i]!;
  }
}

const distDir = resolve(process.cwd(), dirArg);
const rootIndexPath = join(distDir, 'index.html');
if (!existsSync(rootIndexPath)) {
  console.error(`[serve-preview-dist] Missing index.html at ${rootIndexPath}`);
  process.exit(1);
}

function normalizeBasePrefix(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '/') return '';
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLead.endsWith('/') ? withLead.slice(0, -1) : withLead;
}

function detectBasePrefix(indexHtml: string): string {
  if (baseOverride) return normalizeBasePrefix(baseOverride);
  const match = indexHtml.match(/(?:src|href)="(\/[^"]*?)\/assets\/main-[^"]+\.js"/);
  return match?.[1] ? normalizeBasePrefix(match[1]) : '';
}

const indexHtml = readFileSync(rootIndexPath, 'utf8');
const basePrefix = detectBasePrefix(indexHtml);

function resolveSafeFile(relPath: string): string | null {
  const cleanRel = relPath.replace(/^\/+/, '');
  const candidate = resolve(distDir, cleanRel);
  if (candidate !== distDir && !candidate.startsWith(distDir + sep)) {
    return null;
  }
  try {
    const st = statSync(candidate);
    if (st.isFile()) return candidate;
    if (st.isDirectory()) {
      const nestedIndex = join(candidate, 'index.html');
      if (existsSync(nestedIndex) && statSync(nestedIndex).isFile()) {
        return nestedIndex;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function cacheControlFor(pathname: string): string {
  if (pathname.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable';
  }
  return 'no-cache';
}

const server = Bun.serve({
  hostname: host,
  port,
  fetch(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(req.url);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    if (basePrefix && (pathname === basePrefix || pathname.startsWith(`${basePrefix}/`))) {
      pathname = pathname.slice(basePrefix.length) || '/';
    }

    const exact = resolveSafeFile(pathname);
    if (exact) {
      const file = Bun.file(exact);
      return new Response(req.method === 'HEAD' ? null : file, {
        status: 200,
        headers: {
          'Content-Type': file.type,
          'Cache-Control': cacheControlFor(pathname),
        },
      });
    }

    const lastSegment = pathname.split('/').pop() ?? '';
    if (extname(lastSegment) !== '') {
      return new Response('Not Found', { status: 404 });
    }

    const fallback = Bun.file(rootIndexPath);
    return new Response(req.method === 'HEAD' ? null : fallback, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  },
});

console.log(
  `[serve-preview-dist] Serving ${distDir} at http://${server.hostname}:${server.port}/` +
    (basePrefix ? ` (stripping base prefix ${basePrefix})` : ''),
);
