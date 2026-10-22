/**
 * config.test.ts - ICE server assembly for the WebRTC cast transport.
 *
 * STUN alone only connects when sender and Chromecast share a routable
 * network. A TURN relay (opt-in via VITE_CAST_TURN_URL) is what allows a
 * phone on cellular / guest Wi-Fi to reach the TV — the mobile cast failure
 * this configuration supports.
 */
import { describe, it, expect } from 'bun:test';
import { buildIceServers } from '../config';

describe('buildIceServers', () => {
    it('falls back to the public Google STUN server when no env is set', () => {
        expect(buildIceServers({})).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
    });

    it('honors a custom STUN URL', () => {
        expect(buildIceServers({ VITE_CAST_STUN_URL: 'stun:stun.example.com:3478' })).toEqual([
            { urls: 'stun:stun.example.com:3478' },
        ]);
    });

    it('appends TURN with credentials when configured', () => {
        const servers = buildIceServers({
            VITE_CAST_TURN_URL: 'turn:turn.example.com:3478',
            VITE_CAST_TURN_USERNAME: 'wod',
            VITE_CAST_TURN_CREDENTIAL: 'secret',
        });
        expect(servers).toEqual([
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'turn:turn.example.com:3478', username: 'wod', credential: 'secret' },
        ]);
    });

    it('omits TURN credentials when unset', () => {
        const servers = buildIceServers({ VITE_CAST_TURN_URL: 'turn:turn.example.com:3478' });
        expect(servers[1]).toEqual({ urls: 'turn:turn.example.com:3478' });
    });

    it('ignores blank TURN URLs', () => {
        expect(buildIceServers({ VITE_CAST_TURN_URL: '   ' })).toEqual([
            { urls: 'stun:stun.l.google.com:19302' },
        ]);
    });
});
