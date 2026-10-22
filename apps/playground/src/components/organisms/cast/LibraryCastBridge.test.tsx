/**
 * LibraryCastBridge.test.tsx — the cast-and-walk-away round trip, headless.
 *
 * Sender side: the bridge pushes the catalog when a session connects and
 * routes the browser when the receiver picks an entry. Hostile payloads
 * (absolute URLs) must be dropped at the bridge, never handed to the router.
 */

import { describe, expect, it } from 'bun:test';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LibraryCastBridge } from './LibraryCastBridge';
import { toLibraryEntries } from '@/hooks/useLibraryCatalog';
import { FakeRpcTransport } from '@/testing/transport/FakeRpcTransport';
import { CastTransportProvider } from '@/contexts/CastTransportContext';
import type { RpcMessage } from '@/services/cast/rpc/RpcMessages';

function openNotebookEvent(data: unknown): RpcMessage {
    // Wire data is untrusted — cast through unknown exactly as the
    // transport does before the bridge validates it.
    return { type: 'rpc-event', name: 'open-notebook', timestamp: Date.now(), data } as unknown as RpcMessage;
}

async function connectedBridge(): Promise<FakeRpcTransport> {
    const transport = new FakeRpcTransport();
    // Production mounts the bridge only after CastButtonRpc has a connected
    // session (the transport enters context post-connect) — mirror that.
    await transport.connect();
    render(
        <MemoryRouter initialEntries={['/home']}>
            <Routes>
                <Route path="/collections/girls" element={<div>girls-page</div>} />
                <Route path="*" element={
                    <CastTransportProvider transport={transport}>
                        <LibraryCastBridge />
                        <div>still-home</div>
                    </CastTransportProvider>
                } />
            </Routes>
        </MemoryRouter>,
    );
    await waitFor(() => expect(transport.filter('rpc-library-state').length).toBeGreaterThan(0));
    return transport;
}

describe('LibraryCastBridge', () => {
    it('pushes the library catalog when the session connects', async () => {
        const transport = await connectedBridge();
        const push = transport.filter('rpc-library-state')[0];
        expect(Array.isArray(push.entries)).toBe(true);
    });

    it('navigates the browser on a valid open-notebook event', async () => {
        const transport = await connectedBridge();
        act(() => transport.receive(openNotebookEvent({ href: '/collections/girls' })));
        await waitFor(() => expect(screen.getByText('girls-page')).toBeTruthy());
    });

    it('drops an absolute-URL payload without navigating', async () => {
        const transport = await connectedBridge();
        act(() => {
            transport.receive(openNotebookEvent({ href: 'https://evil.example' }));
            transport.receive(openNotebookEvent({ href: '//evil.example' }));
        });
        expect(screen.getByText('still-home')).toBeTruthy();
    });
});

describe('toLibraryEntries', () => {
    it('yields well-formed, sender-relative entries from the live catalog', () => {
        const entries = toLibraryEntries(null);
        for (const entry of entries) {
            expect(entry.notebookId.length).toBeGreaterThan(0);
            expect(entry.title.length).toBeGreaterThan(0);
            expect(entry.href.startsWith('/')).toBe(true);
            expect(entry.itemCount).toBeGreaterThan(0);
        }
    });
});
