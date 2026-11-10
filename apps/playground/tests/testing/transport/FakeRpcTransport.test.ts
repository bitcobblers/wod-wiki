import { describe, it, expect } from 'bun:test';
import type { RpcEvent, RpcMessage } from '@/services/cast/rpc/RpcMessages';
import { FakeRpcTransport, connectPair } from './FakeRpcTransport';

const makeDispose = (): RpcMessage => ({ type: 'rpc-dispose' });
const makeEvent = (name = 'test'): RpcEvent => ({ type: 'rpc-event', name, timestamp: 0 });
const makeClockRequest = (): RpcMessage => ({ type: 'rpc-clock-sync-request', timestamp: 0 });

describe('FakeRpcTransport', () => {
    it('captures sent messages', () => {
        const t = new FakeRpcTransport();
        t.send(makeDispose());
        t.send(makeEvent('a'));
        t.send(makeClockRequest());

        expect(t.sent.length).toBe(3);
        expect(t.sent[0].type).toBe('rpc-dispose');
        expect(t.sent[1].type).toBe('rpc-event');
        expect(t.sent[2].type).toBe('rpc-clock-sync-request');

        expect(t.filter('rpc-event').length).toBe(1);
        expect(t.filter('rpc-event')[0]).toEqual(makeEvent('a'));
    });

    it('receive() invokes onMessage handlers', () => {
        const t = new FakeRpcTransport();
        const received: RpcMessage[] = [];
        t.onMessage((m) => received.push(m));

        t.receive(makeEvent('hello'));

        expect(received.length).toBe(1);
        expect(received[0]).toEqual(makeEvent('hello'));
    });

    it('unsubscribe removes a handler', () => {
        const t = new FakeRpcTransport();
        const received: RpcMessage[] = [];
        const unsub = t.onMessage((m) => received.push(m));

        unsub();
        t.receive(makeEvent('after-unsub'));

        expect(received.length).toBe(0);
    });

    it('connectPair: send on A delivers to B', () => {
        const a = new FakeRpcTransport();
        const b = new FakeRpcTransport();
        const received: RpcMessage[] = [];
        b.onMessage((m) => received.push(m));

        connectPair(a, b);
        a.send(makeEvent('from-a'));

        expect(received.length).toBe(1);
        expect(received[0]).toEqual(makeEvent('from-a'));
    });

    it('connectPair: B is connected after pair', () => {
        const a = new FakeRpcTransport();
        const b = new FakeRpcTransport();

        connectPair(a, b);

        expect(b.connected).toBe(true);
        expect(a.connected).toBe(true);
    });

    it('dispose clears handlers and prevents further send', () => {
        const a = new FakeRpcTransport();
        const b = new FakeRpcTransport();
        const receivedByB: RpcMessage[] = [];
        b.onMessage((m) => receivedByB.push(m));

        connectPair(a, b);
        a.dispose();
        expect(() => a.send(makeEvent('after-dispose'))).toThrow('FakeRpcTransport: send after dispose');
        expect(receivedByB.length).toBe(0);

        // And should throw on the disposed transport
        expect(() => a.send(makeEvent('throws'))).toThrow('FakeRpcTransport: send after dispose');
    });
});
