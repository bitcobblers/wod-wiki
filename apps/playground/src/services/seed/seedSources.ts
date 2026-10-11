/**
 * Custom seed sources — community libraries the user registers on
 * /settings/sync. Persisted in localStorage and merged into
 * defaultSeedSources() so every sync path (boot, manual, status) sees them.
 * Custom sources never auto-import at boot (autoImport: false) and carry
 * embeddedVersion 0 — never fast-pathable, the manifest is consulted on
 * every sync. Type-only dependency on seedSync keeps the runtime graph
 * acyclic (seedSync imports this module's values).
 */

/** Shape persisted in localStorage — a seed dir URL serving the standard
 *  manifest/chunks layout (see HttpSeedSource). */
export interface CustomSeedSource {
  id: string;
  label: string;
  /** Absolute http(s) URL of the seed dir, trailing slash included. */
  url: string;
}

const STORAGE_KEY = 'wodwiki.seedSources';

function readAll(): CustomSeedSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is CustomSeedSource =>
        !!s && typeof s === 'object' &&
        typeof (s as CustomSeedSource).id === 'string' &&
        typeof (s as CustomSeedSource).label === 'string' &&
        typeof (s as CustomSeedSource).url === 'string',
    );
  } catch {
    return [];
  }
}

/** Registered custom sources, storage order. */
export function customSeedSources(): CustomSeedSource[] {
  return readAll();
}

/** Names the URL→id formula: lowercase, non-alphanumerics collapse to one
 *  dash, trimmed dashes; empty input degenerates to 'source'. */
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
}

/**
 * Register a community library. The URL must be absolute http(s) and is
 * normalized to a trailing slash (HttpSeedSource concatenates file names).
 * The seed id namespaces the storage checkpoint — renaming later would
 * orphan the imported content, so the id is fixed at registration.
 */
export function addCustomSeedSource(label: string, url: string): CustomSeedSource {
  const cleanUrl = url.trim();
  if (!/^https?:\/\//i.test(cleanUrl)) {
    throw new Error('Enter an absolute http(s) URL of a seed directory.');
  }
  const normalized = cleanUrl.endsWith('/') ? cleanUrl : `${cleanUrl}/`;
  const list = readAll();
  if (list.some(s => s.url === normalized)) {
    throw new Error('This source is already registered.');
  }
  const cleanLabel = label.trim() || (() => { try { return new URL(normalized).hostname; } catch { return 'Source'; } })();
  // Static string-keyed uniqueness table — the source ids already issued.
  const taken: Record<string, true> = {};
  for (const s of list) taken[s.id] = true;
  let id = slugify(cleanLabel);
  for (let n = 2; taken[id]; n++) id = `${slugify(cleanLabel)}-${n}`;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...list, { id, label: cleanLabel, url: normalized }]));
  return { id, label: cleanLabel, url: normalized };
}

/** Unregister a source. The storage checkpoint and imported notes stay —
 *  removing a source only removes it from sync runs and the status list. */
export function removeCustomSeedSource(id: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readAll().filter(s => s.id !== id)));
}
