/**
 * useZipProcessor — Global zip-load handler for the /load route.
 *
 * Branches on the param name (#882):
 *  - `?z=` (+ optional `by`) is the home-hero share contract: decode, persist
 *    to the home-shared localStorage store AND to a persisted playground
 *    entry (the runtime binds to it on Run), then redirect to `/`, where the
 *    hero editor renders the shared script instead of welcome-1.md until the
 *    visitor resets it. Arrival never auto-runs the workout.
 *  - `?zip=` stays the playground flow: import as a new playground entry via
 *    the intake module, redirect to /playground/:id. Importing never
 *    auto-runs the workout.
 *
 * Both paths surface decode/storage failures with a toast — a bad share link
 * or a blocked store must not fail silently.
 *
 * Only runs on the plain /load route — /load/journal* is handled by
 * useJournalZipProcessor.
 */
import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryState } from 'nuqs';
import { playgroundPath, ROUTE_PATTERNS } from '../lib/routes';
import { decodeZip } from '../services/decodeZip';
import { buildSharedScript, saveHomeShared } from '../services/homeSharedScript';
import { createPlaygroundPage, ensurePlaygroundEntry } from '../services/createPlaygroundPage';
import { toast } from '@/hooks/use-toast';

export function useZipProcessor() {
  const navigate = useNavigate();
  const location = useLocation();
  const [zipParam] = useQueryState('zip');
  const [zParam] = useQueryState('z');
  const [byParam] = useQueryState('by');
  // Spawn provenance: /load?zip=…&src=/notebook/<cat>/<name> (openBlockInPlayground)
  // stamps the source page path onto the created playground note.
  const [srcParam] = useQueryState('src');

  useEffect(() => {
    // Plain /load route, or home route (/) when handling ?z= home shares (#882).
    if (location.pathname !== '/load' && !(location.pathname === '/' && zParam)) return;

    if (zParam) {
      let cancelled = false;
      (async () => {
        try {
          const content = await decodeZip(zParam);
          if (content === null) throw new Error('Invalid workout link');
          if (cancelled) return;
          const script = buildSharedScript(content, byParam ?? undefined);
          // Persist the shared script as the home playground entry — the
          // hero's Run updates this entry and records results against its
          // UUID. Arrival itself never starts a run.
          await ensurePlaygroundEntry(script, { reuseKey: 'home', title: 'Home playground' });
          if (cancelled) return;
          saveHomeShared({ content: script, by: byParam ?? undefined });
        } catch (err) {
          console.error('Failed to decode zip:', err);
          if (!cancelled) {
            toast({
              title: 'Could not import workout',
              description: 'The link was invalid or the workout could not be saved.',
              variant: 'destructive',
            });
          }
        }
        if (!cancelled) {
          navigate('/', { replace: true });
        }
      })();
      return () => { cancelled = true; };
    }

    if (!zipParam) return;

    let cancelled = false;
    // Only accept well-formed app paths as provenance — the param is URL data.
    const sourcePath = srcParam && srcParam.startsWith('/') ? srcParam : undefined;
    (async () => {
      try {
        const content = await decodeZip(zipParam);
        if (content === null) throw new Error('Invalid workout link');
        if (cancelled) return;
        const name = sourcePath
          ? await createPlaygroundPage(content, { sourcePath })
          : await createPlaygroundPage(content);
        if (!cancelled) {
          navigate(playgroundPath(name), { replace: true });
        }
      } catch (err) {
        console.error('Failed to decode zip:', err);
        if (!cancelled) {
          toast({
            title: 'Could not import workout',
            description: 'The link was invalid or the workout could not be saved.',
            variant: 'destructive',
          });
          navigate(ROUTE_PATTERNS.home, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [zipParam, zParam, byParam, srcParam, navigate, location.pathname]);
}
