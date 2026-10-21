/**
 * libraryWire.test.ts — cast-boundary validation for the library channel.
 *
 * `parseOpenNotebookPayload` is the only gate between a cast device and the
 * browser's router; `isRpcLibraryState` is the gate between the browser and
 * the receiver's UI. A malformed or hostile payload must be dropped, never
 * guessed into a default.
 */

import { describe, expect, it } from 'bun:test';
import {
    isRpcLibraryState,
    parseOpenNotebookPayload,
    type RpcLibraryState,
} from '../RpcMessages';

const validLibrary: RpcLibraryState = {
    type: 'rpc-library-state',
    entries: [{ notebookId: 'crossfit-programming', title: 'CrossFit Programming', href: '/collections/crossfit-programming', itemCount: 12 }],
};

describe('parseOpenNotebookPayload', () => {
    it('accepts a sender-relative route', () => {
        expect(parseOpenNotebookPayload({ href: '/collections/girls' })).toEqual({ href: '/collections/girls' });
    });

    it('drops absolute URLs, protocol-relative hrefs, and non-strings', () => {
        expect(parseOpenNotebookPayload({ href: 'https://evil.example' })).toBeNull();
        expect(parseOpenNotebookPayload({ href: '//evil.example' })).toBeNull();
        expect(parseOpenNotebookPayload({ href: 'javascript:alert(1)' })).toBeNull();
        expect(parseOpenNotebookPayload({ href: '' })).toBeNull();
        expect(parseOpenNotebookPayload({ href: 42 })).toBeNull();
        expect(parseOpenNotebookPayload({})).toBeNull();
        expect(parseOpenNotebookPayload(null)).toBeNull();
        expect(parseOpenNotebookPayload('naked-string')).toBeNull();
    });
});

describe('isRpcLibraryState', () => {
    it('accepts a well-formed catalog', () => {
        expect(isRpcLibraryState(validLibrary)).toBe(true);
        expect(isRpcLibraryState({ type: 'rpc-library-state', entries: [] })).toBe(true);
    });

    it('rejects wrong type, missing entries, and malformed rows', () => {
        const wire = (data: unknown) => isRpcLibraryState(data as RpcMessage);
        expect(wire({ type: 'rpc-workbench-update' })).toBe(false);
        expect(wire({ type: 'rpc-library-state' })).toBe(false);
        expect(wire({ type: 'rpc-library-state', entries: 'all' })).toBe(false);
        expect(wire({ type: 'rpc-library-state', entries: [{ notebookId: 'x', title: 7, href: '/c', itemCount: 0 }] })).toBe(false);
        expect(wire({ type: 'rpc-library-state', entries: [null] })).toBe(false);
        expect(wire(null)).toBe(false);
        expect(wire('rpc-library-state')).toBe(false);
    });
});
