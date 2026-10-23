import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { render, act } from '@testing-library/react';
import React from 'react';
import { ScriptRuntime, createCompiler, EventBus, RuntimeStack, RuntimeClock, RegisterEventHandlerAction, SOUND_PLAY_EVENT } from '@bitcobblers/wod-wiki-engine';

const played: Array<{ name: string; volume?: number }> = [];

mock.module('@/services/AudioService', () => ({
    audioService: {
        isEnabled: () => true,
        setEnabled: () => { },
        playSound: (name: string, volume = 1.0) => {
            played.push({ name, volume });
            return Promise.resolve();
        },
    },
    UnknownSoundError: class UnknownSoundError extends Error { },
}));

mock.module('@/contexts/CastTransportContext', () => ({
    useCastTransport: () => null,
}));

const { AudioProvider, useAudio } = await import('@/contexts/AudioContext');

/**
 * A component that plays a sound the way a runtime cue does.
 */
function SoundTrigger({ name }: { name: string }) {
    const { playSound } = useAudio();
    return <button data-testid="play" onClick={() => playSound(name)}>play</button>;
}

describe('runtime sound bridge', () => {
    beforeEach(() => { played.length = 0; });

    it('plays a sound through the audio context', async () => {
        render(<AudioProvider><SoundTrigger name="countdown-beep" /></AudioProvider>);
        await act(async () => {
            (document.querySelector('[data-testid="play"]') as HTMLElement).click();
        });
        expect(played.map(p => p.name)).toEqual(['countdown-beep']);
    });

    it('registers a handler that receives a sound:play event from the runtime', () => {
        // Reproduces the wiring the workbench uses: a handler registered with
        // owner id 'global' must have the 'global' scope to ever fire.
        const compiler = createCompiler();
        const stack = new RuntimeStack();
        const eventBus = new EventBus();
        const runtime = new ScriptRuntime(
            { content: '', statements: [] } as never,
            compiler,
            { stack, clock: new RuntimeClock(), eventBus },
        );

        const received: string[] = [];
        const handler = {
            id: 'global-audio-handler',
            name: 'GlobalAudioHandler',
            handler: (event: { name: string }) => {
                received.push(event.name);
                return [];
            },
        };

        new RegisterEventHandlerAction(handler as never, 'global', 'global').do(runtime as never);
        runtime.handle({ name: SOUND_PLAY_EVENT, timestamp: new Date(), data: { sound: 'beep' } } as never);

        expect(received).toEqual([SOUND_PLAY_EVENT]);
    });
});
