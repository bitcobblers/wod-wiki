import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { audioService } from '@/hooks/useBrowserServices';
import { useCastTransport } from '@/contexts/CastTransportContext';

export interface AudioContextType {
    isEnabled: boolean;
    toggleAudio: () => void;
    playTestSound: () => void;
    playSound: (name: string, volume?: number) => void;
    playClick: () => void;
}

// Named WodAudioContext to avoid conflict with Web Audio API's native AudioContext
const WodAudioContext = createContext<AudioContextType | undefined>(undefined);

export function AudioProvider({ children }: { children: React.ReactNode }) {
    const [isEnabled, setIsEnabled] = useState(audioService.isEnabled());
    const castTransport = useCastTransport();

    useEffect(() => {
        // Sync service state with component state
        audioService.setEnabled(isEnabled);
    }, [isEnabled]);

    const playSound = useCallback((name: string, volume: number = 1.0) => {
        if (!isEnabled) return;

        if (castTransport?.connected) {
            console.log(`[AudioContext] Routing sound '${name}' to cast receiver`);
            try {
                castTransport.send({
                    type: 'rpc-audio',
                    name,
                    volume
                });
            } catch (err) {
                console.error('[AudioContext] Failed to send rpc-audio', err);
                // Fallback to local if cast send fails
                audioService.playSound(name, volume).catch(reportPlaybackFailure);
            }
        } else {
            audioService.playSound(name, volume).catch(reportPlaybackFailure);
        }
    }, [isEnabled, castTransport]);

    const toggleAudio = useCallback(() => {
        const newState = !isEnabled;
        setIsEnabled(newState);
        // Note: useEffect syncs the service state, no need to call setEnabled here

        if (newState) {
            // Local beep to confirm toggle. Played directly rather than through
            // `playSound` because the service is still disabled at this point
            // — the effect that enables it runs after this handler.
            audioService.setEnabled(true);
            audioService.playSound('beep').catch(reportPlaybackFailure);
        }
    }, [isEnabled]);

    const playTestSound = useCallback(() => {
        playSound('chime');
    }, [playSound]);

    const playClick = useCallback(() => {
        playSound('click', 0.5);
    }, [playSound]);

    const value = useMemo(() => ({
        isEnabled,
        toggleAudio,
        playTestSound,
        playSound,
        playClick
    }), [isEnabled, toggleAudio, playTestSound, playSound, playClick]);

    return (
        <WodAudioContext.Provider value={value}>
            {children}
        </WodAudioContext.Provider>
    );
}

/**
 * Report a failed playback.
 *
 * A sound that cannot play is worth knowing about — an unknown sound name
 * is a defect in a sound profile, not a transient hiccup.
 */
function reportPlaybackFailure(err: unknown): void {
    console.error('[AudioContext] Sound playback failed', err);
}

export function useAudio() {
    const context = useContext(WodAudioContext);
    if (context === undefined) {
        throw new Error('useAudio must be used within an AudioProvider');
    }
    return context;
}

/**
 * The audio context, or `null` when no provider is mounted.
 *
 * For components that can run without audio — a hook used in isolation, or
 * a surface rendered outside the app shell — so a missing provider degrades
 * to silence rather than throwing.
 */
export function useAudioOptional(): AudioContextType | null {
    return useContext(WodAudioContext);
}
