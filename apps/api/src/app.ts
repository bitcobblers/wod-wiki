/**
 * app.ts — one native fetch handler for the whole surface:
 *   GET  /api/health
 *   GET  /api/v1/:store/get?key=            GET /api/v1/:store/all?range=&count=
 *   GET  /api/v1/:store/index/:idx?range=&count=
 *   GET  /api/v1/:store/count?range=&index=
 *   PUT  /api/v1/:store {value}             DELETE /api/v1/:store?key=
 *   POST /api/v1/:store/clear               POST /api/v1/tx {ops}
 *   POST /api/v1/wipe                       POST /api/v1/query
 * everything else: static SPA serving from playgroundDist (asset miss with an
 * extension → 404; extensionless → index.html; traversal/symlink escapes →
 * 403; /api never falls through to the SPA).
 */

import { join, resolve, sep } from 'node:path';
import { stat, realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { HttpError } from './errors';
import {
  handleDomainQuery,
  refreshDomain,
  wipeDomain,
  MAX_BODY,
  StorageError,
  storeDefinition,
  getRow,
  listRows,
  countRows,
  wipeRows,
  type Database,
} from '@bitcobblers/wod-wiki-storage/sql';
import type { KeyDTO, RangeDTO, TxOp } from '@bitcobblers/wod-wiki-storage';

const json = (value: unknown, status: number): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const plain = (body: string, status: number): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

const notFound = (): Response => json({ error: 'not found' }, 404);
const methodNotAllowed = (): Response => json({ error: 'method not allowed' }, 405);

const noContent = (): Response => new Response(null, { status: 204 });

/** URLSearchParams already applies the form-urlencoded '+' → space then %XX
 * decoding the wire contract relies on. */
const qget = (url: URL, name: string): string | undefined => url.searchParams.get(name) ?? undefined;

function jsonParam(url: URL, name: string): unknown {
  const raw = qget(url, name);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, `invalid JSON in ?${name}`);
  }
}

/** ?range accepts a RangeDTO object or a bare key (scalar/tuple → {only}). */
function rangeParam(url: URL): RangeDTO | undefined {
  const v = jsonParam(url, 'range');
  if (v === undefined) return undefined;
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as RangeDTO;
  return { only: v as KeyDTO };
}

function countParam(url: URL): number | undefined {
  const raw = qget(url, 'count');
  if (raw === undefined) return undefined;
  const n = Number(raw); // Number('') === 0, matching the wire contract
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'invalid ?count');
  return Math.trunc(n);
}

async function readJsonBody(req: Request, maxBytes?: number): Promise<unknown> {
  const body = await req.text();
  if (maxBytes !== undefined && body.length > maxBytes) {
    throw new HttpError(413, `domain query body exceeds ${maxBytes} bytes`);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HttpError(400, 'body must be valid JSON');
  }
}

// ── Static SPA serving ───────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  webmanifest: 'application/manifest+json',
  xml: 'application/xml',
  txt: 'text/plain; charset=utf-8',
};

async function realpathSafe(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

async function serveFile(real: string, rel: string): Promise<Response> {
  // Seed chunks are content-hashed; everything else revalidates.
  const cache = rel.includes('seed/chunks/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
  return new Response(Bun.file(real), {
    headers: { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': cache },
  });
}

async function serveSpaShell(distRoot: string): Promise<Response | undefined> {
  const index = await realpathSafe(join(distRoot, 'index.html'));
  // Same symlink confinement as assets: a dist/index.html symlink pointing
  // outside must not become the shell.
  if (index && (index === distRoot || index.startsWith(distRoot + sep))
    && (await stat(index).then((s) => s.isFile(), () => false))) {
    return new Response(Bun.file(index), {
      headers: { 'content-type': MIME.html, 'cache-control': 'no-cache' },
    });
  }
  return undefined;
}

async function staticResponse(distRoot: string | undefined, method: string, pathname: string): Promise<Response> {
  if (method !== 'GET') return plain('method not allowed', 405);
  if (!distRoot) {
    return plain('wod-wiki-api: playground dist not found. Set PLAYGROUND_DIST or run the playground server build.', 503);
  }
  let rel: string;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return plain('bad request', 400);
  }
  if (rel === '') rel = 'index.html';
  const parts = rel.split('/');
  if (parts.some((p) => p === '..')) return plain('forbidden', 403);
  const base = parts[parts.length - 1] ?? '';
  const hasExtension = base.includes('.');

  const abs = resolve(distRoot, ...parts);
  const real = await realpathSafe(abs);
  // Symlink confinement: serve only paths that really live under the dist root.
  if (real && (real === distRoot || real.startsWith(distRoot + sep))) {
    const info = await stat(real).then((s) => s.isFile(), () => false);
    if (info) return serveFile(real, rel);
  }
  // SPA fallback: extensionless paths render the app shell.
  if (!hasExtension) {
    const shell = await serveSpaShell(distRoot);
    if (shell) return shell;
  }
  return plain('not found', 404);
}

// ── API routing ──────────────────────────────────────────────────────────────

async function storeRoutes(db: Database, method: string, sub: string, url: URL, req: Request): Promise<Response> {
  let inner = sub.slice('/v1/'.length);
  if (inner.endsWith('/')) inner = inner.slice(0, -1);
  if (inner === '') return notFound();
  const segments = inner.split('/');
  let name: string;
  let action: string | undefined;
  if (segments.length === 1) {
    name = segments[0];
  } else if (segments.length === 2) {
    [name, action] = segments;
  } else if (segments.length === 3 && segments[1] === 'index' && segments[2] !== '') {
    [name, , action] = segments;
    action = `index/${action}`;
  } else {
    return notFound();
  }
  const def = storeDefinition(name); // 404 for unknown stores

  const range = rangeParam(url);
  const count = countParam(url);

  if (action === 'get' && method === 'GET') {
    const key = jsonParam(url, 'key');
    if (key === undefined) throw new HttpError(400, 'missing ?key');
    const row = await getRow(db, def, key as KeyDTO);
    return row === undefined ? notFound() : json(row, 200);
  }
  if (action === 'all' && method === 'GET') {
    return json(await listRows(db, def, range, count), 200);
  }
  if (action === 'count' && method === 'GET') {
    const indexName = qget(url, 'index');
    const n = indexName
      ? await countRows(db, def, range, indexName)
      : await countRows(db, def, range);
    return json({ count: Number(n) }, 200);
  }
  if (action === 'clear' && method === 'POST') {
    await db.transaction((tx) => refreshDomain(tx, [{ op: 'clear', store: def.name }]));
    return noContent();
  }
  if (action?.startsWith('index/') && method === 'GET') {
    return json(await listRows(db, def, range, count, action.slice('index/'.length)), 200);
  }
  if (action === undefined && method === 'PUT') {
    const parsed = await readJsonBody(req);
    const value = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'value' in parsed
      ? parsed.value
      : undefined;
    if (value === undefined) throw new HttpError(400, 'body must be {value: ...}');
    const [key] = await db.transaction((tx) => refreshDomain(tx, [{ op: 'put', store: def.name, value }]));
    return json({ key }, 200);
  }
  if (action === undefined && method === 'DELETE') {
    const keyParam = jsonParam(url, 'key');
    const target = keyParam !== undefined ? keyParam : range;
    if (target === undefined || target === null) throw new HttpError(400, 'DELETE requires ?key or ?range');
    // Wire DELETE accepts a key or a range; the TxOp delete variant types the
    // narrower KeyDTO even though deleteRows honours both.
    await db.transaction((tx) => refreshDomain(tx, [{ op: 'delete', store: def.name, key: target as KeyDTO }]));
    return noContent();
  }
  return methodNotAllowed();
}

async function apiRoutes(db: Database, req: Request, method: string, sub: string, url: URL): Promise<Response> {
  if (sub === '/health') {
    return json({ ok: true, driver: db.dialect }, 200);
  }
  if (sub === '/v1/wipe' && method === 'POST') {
    await db.transaction(async (tx) => {
      // System memberships survive; derived projections follow (empty is consistent).
      await wipeRows(tx);
      await wipeDomain(tx);
    });
    return noContent();
  }
  if (sub === '/v1/tx' && method === 'POST') {
    const parsed = await readJsonBody(req);
    const ops = typeof parsed === 'object' && parsed !== null && 'ops' in parsed ? parsed.ops : undefined;
    if (!Array.isArray(ops)) throw new HttpError(400, 'tx body must be {ops: []}');
    const results = await db.transaction((tx) => refreshDomain(tx, ops as TxOp[]));
    return json({ results }, 200);
  }
  if (sub === '/v1/query') {
    if (method !== 'POST') return methodNotAllowed();
    const body = await readJsonBody(req, MAX_BODY);
    return json(await handleDomainQuery(db, body), 200);
  }
  if (sub.startsWith('/v1/')) return storeRoutes(db, method, sub, url, req);
  return notFound();
}

// ── Handler factory ──────────────────────────────────────────────────────────

function distRootOf(playgroundDist: string | undefined): string | undefined {
  if (!playgroundDist) return undefined;
  try {
    return realpathSync(playgroundDist);
  } catch {
    return undefined;
  }
}

export function createHandler(
  db: Database,
  options: { playgroundDist: string },
): (request: Request) => Promise<Response> {
  const distRoot = distRootOf(options.playgroundDist);
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const method = request.method === 'HEAD' ? 'GET' : request.method; // Bun strips HEAD bodies
      const path = url.pathname;
      const response = path === '/api' || path.startsWith('/api/')
        ? await apiRoutes(db, request, method, path.slice('/api'.length) || '/', url)
        : await staticResponse(distRoot, method, path);
      return response;
    } catch (e) {
      if (e instanceof HttpError || e instanceof StorageError) {
        const status = e.status;
        if (status >= 500) console.error('[wod-wiki-api]', e.message);
        const body: { error: string; code?: string } = { error: status >= 500 ? 'internal error' : e.message };
        if (e.code) body.code = e.code;
        return json(body, status);
      }
      console.error('[wod-wiki-api]', e);
      return json({ error: 'internal error' }, 500);
    }
  };
}
