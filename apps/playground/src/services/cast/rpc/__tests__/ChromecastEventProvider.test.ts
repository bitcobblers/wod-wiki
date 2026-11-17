import { describe, it, expect, beforeEach } from 'bun:test';
import { ChromecastEventProvider } from '../ChromecastEventProvider';
import { IRpcTransport, RpcUnsubscribe } from '../IRpcTransport';
import { RpcMessage, RpcEvent } from '../RpcMessages';
import { IEvent } from '@bitcobblers/wod-wiki-engine';

// ── Mock Transport ──────────────────────────────────────────────────────────

class MockTransport implements IRpcTransport {
    connected = true;
    sent: RpcMessage[] = [];
    private readonly messageHandlers = new Set<(msg: RpcMessage) => void>();

    send(message: RpcMessage): void {
        this.sent.push(message);
    }

    onMessage(handler: (message: RpcMessage) => void): RpcUnsubscribe {
        this.messageHandlers.add(handler);
        return () => this.messageHandlers.delete(handler);
    }

    onConnected(): RpcUnsubscribe { return () => {}; }
    onDisconnected(): RpcUnsubscribe { return () => {}; }
    get needsClockSync(): boolean { return false; }
    dispose(): void { this.messageHandlers.clear(); }

    /** Simulate receiving a message from the receiver */
    _receive(message: RpcMessage): void {
        for (const h of this.messageHandlers) h(message);
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ChromecastEventProvider', () => {
    let transport: MockTransport;
    let provider: ChromecastEventProvider;

    beforeEach(() => {
        transport = new MockTransport();
        provider = new ChromecastEventProvider(transport);
    });

    describe('onEvent', () => {
        it('should deliver rpc-event messages to handlers', () => {
            const received: IEvent[] = [];
            provider.onEvent(e => received.push(e));

            const rpcEvent: RpcEvent = {
                type: 'rpc-event',
                name: 'next',
                timestamp: Date.now(),
            };
            transport._receive(rpcEvent);

            expect(received).toHaveLength(1);
            expect(received[0].name).toBe('next');
            expect(received[0].timestamp).toBeInstanceOf(Date);
        });

        it('should deliver event data', () => {
            const received: IEvent[] = [];
            provider.onEvent(e => received.push(e));

            transport._receive({
                type: 'rpc-event',
                name: 'custom',
                timestamp: Date.now(),
                data: { key: 'value' },
            });

            expect(received[0].data).toEqual({ key: 'value' });
        });

        it('should not forward non-event messages', () => {
            const received: IEvent[] = [];
            provider.onEvent(e => received.push(e));

            transport._receive({
                type: 'rpc-stack-update',
                snapshotType: 'push',
                blocks: [],
                depth: 0,
                clockTime: Date.now(),
            });

            expect(received).toHaveLength(0);
        });

        it('should deliver to multiple handlers', () => {
            const a: IEvent[] = [];
            const b: IEvent[] = [];
            provider.onEvent(e => a.push(e));
            provider.onEvent(e => b.push(e));

            transport._receive({
                type: 'rpc-event',
                name: 'start',
                timestamp: Date.now(),
            });

            expect(a).toHaveLength(1);
            expect(b).toHaveLength(1);
        });

        it('should support unsubscribe', () => {
            const received: IEvent[] = [];
            const unsub = provider.onEvent(e => received.push(e));
            unsub();

            transport._receive({
                type: 'rpc-event',
                name: 'next',
                timestamp: Date.now(),
            });

            expect(received).toHaveLength(0);
        });

        it('should return no-op unsubscribe after dispose', () => {
            provider.dispose();
            const unsub = provider.onEvent(() => {});
            expect(() => unsub()).not.toThrow();
        });
    });

    describe('dispatch', () => {
        it('should send rpc-event to transport', () => {
            const event: IEvent = {
                name: 'pause',
                timestamp: new Date(),
            };
            provider.dispatch(event);

            expect(transport.sent).toHaveLength(1);
            const msg = transport.sent[0] as RpcEvent;
            expect(msg.type).toBe('rpc-event');
            expect(msg.name).toBe('pause');
            expect(typeof msg.timestamp).toBe('number');
        });

        it('should include event data', () => {
            provider.dispatch({
                name: 'custom',
                timestamp: new Date(),
                data: { foo: 'bar' },
            });

            expect((transport.sent[0] as RpcEvent).data).toEqual({ foo: 'bar' });
        });

        it('should not send when disconnected', () => {
            transport.connected = false;
            provider.dispatch({ name: 'next', timestamp: new Date() });
            expect(transport.sent).toHaveLength(0);
        });

        it('should not send after dispose', () => {
            provider.dispose();
            provider.dispatch({ name: 'next', timestamp: new Date() });
            expect(transport.sent).toHaveLength(0);
        });
    });

    describe('dispose', () => {
        it('should stop delivering events after dispose', () => {
            const received: IEvent[] = [];
            provider.onEvent(e => received.push(e));
            provider.dispose();

            transport._receive({
                type: 'rpc-event',
                name: 'next',
                timestamp: Date.now(),
            });

            expect(received).toHaveLength(0);
        });

        it('should be safe to call multiple times', () => {
            expect(() => {
                provider.dispose();
                provider.dispose();
            }).not.toThrow();
        });
    });
});
