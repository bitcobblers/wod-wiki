/**
 * LibraryCastBridge — renderless component that pushes the notebook library
 * to the Chromecast receiver and routes the browser when the receiver picks
 * an entry.
 *
 * Placement: inside Workbench, alongside WorkbenchCastBridge. While a cast
 * session is active the receiver shows this listing whenever the workbench
 * has nothing workout-shaped to display (idle, or a preview with no blocks)
 * — the "cast and walk away" entry point: pick a notebook from the couch,
 * the browser routes to it, and the existing block-selection / timer flow
 * takes over.
 *
 * The catalog mirrors the home gallery exactly: same `buildSeedCatalog`
 * inputs, same default sort. Only installed seeds with local rows are
 * offered — a couch cannot import a package.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCastTransport } from '@/contexts/CastTransportContext';
import { useSeedContent } from '@/services/content/seedContent';
import { listNotebooks, listSeedSources } from '@/services/seed/seedSources';
import {
    parseOpenNotebookPayload,
    type RpcLibraryEntry,
    type RpcLibraryState,
    type RpcMessage,
} from '@/services/cast/rpc/RpcMessages';
import {
    buildSeedCatalog,
    filterSeeds,
    sortSeeds,
} from '../../../../app/views/notebook-gallery/notebookGalleryModel';
import type { SeedContentFiles } from '@/services/content/seedContent';

/**
 * Pure mapping from the home-gallery catalog to the cast library payload.
 * Exported for tests; the bridge keeps no library state of its own.
 */
export function toLibraryEntries(files: SeedContentFiles | null): RpcLibraryEntry[] {
    const catalog = buildSeedCatalog(listNotebooks(), files, listSeedSources());
    return sortSeeds(filterSeeds(catalog, {}), 'updated')
        .filter((seed) => seed.installed && seed.itemCount > 0)
        .map((seed) => ({
            notebookId: seed.slug,
            title: seed.label,
            href: seed.href,
            itemCount: seed.itemCount,
        }));
}

export const LibraryCastBridge: React.FC = () => {
    const castTransport = useCastTransport();
    const navigate = useNavigate();
    const files = useSeedContent();
    const entries = useMemo(() => toLibraryEntries(files), [files]);

    // Fingerprint of the last pushed catalog — avoids redundant sends, and
    // resets on disconnect so a reconnect re-pushes the current catalog.
    const lastFingerprintRef = useRef('');

    useEffect(() => {
        if (!castTransport?.connected) {
            lastFingerprintRef.current = '';
            return;
        }
        const message: RpcLibraryState = { type: 'rpc-library-state', entries };
        const fingerprint = JSON.stringify(message);
        if (fingerprint === lastFingerprintRef.current) return;
        lastFingerprintRef.current = fingerprint;
        try {
            castTransport.send(message);
        } catch (err) {
            console.warn('[LibraryCastBridge] Failed to send library state:', err);
        }
    }, [castTransport, entries]);

    // Receiver picked an entry from the couch: route the browser to it.
    // Payload is validated at the cast boundary — only sender-relative
    // routes pass, so a hostile payload cannot navigate off-app.
    useEffect(() => {
        if (!castTransport?.connected) return;
        const unsub = castTransport.onMessage((message: RpcMessage) => {
            if (message.type !== 'rpc-event' || message.name !== 'open-notebook') return;
            const payload = parseOpenNotebookPayload(message.data);
            if (!payload) {
                console.warn('[LibraryCastBridge] Dropped malformed open-notebook payload');
                return;
            }
            navigate(payload.href);
        });
        return unsub;
    }, [castTransport, navigate]);

    return null;
};
