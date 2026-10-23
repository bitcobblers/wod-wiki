import { IRuntimeBlock } from './IRuntimeBlock';
import type { TestableBlockConfig } from './ITestableBlockConfig';
import type { IEffortResolver } from '../../effort-registry/types';
import type { ReferenceIndex } from '../../effort-registry/reference-resolution';
import type { SoundProfile } from '../sound/SoundProfile';

/**
 * Factory function type for wrapping blocks in debug mode.
 * Receives the original block and returns a wrapped version.
 */
export type BlockWrapperFactory = (block: IRuntimeBlock, config?: TestableBlockConfig) => IRuntimeBlock;

/**
 * Configuration options for ScriptRuntime initialization.
 * These options control debugging, logging, and testing capabilities.
 */
export interface IRuntimeOptions {
    /**
     * Enable debug mode for the runtime.
     * When true:
     * - All blocks pushed to the stack are automatically wrapped with TestableBlock
     * - Additional lifecycle events are logged
     */
    debugMode?: boolean;

    /**
     * Custom factory for wrapping blocks when debugMode is true.
     * If not provided, uses the default TestableBlock wrapper with spy mode.
     */
    blockWrapperFactory?: BlockWrapperFactory;

    /**
     * Default configuration for TestableBlock wrappers.
     * Applied to all blocks wrapped in debug mode unless overridden.
     */
    defaultTestableConfig?: Partial<TestableBlockConfig>;

    /**
     * Enable console logging for runtime debug output.
     * Automatically set to true when debugMode is true.
     */
    enableLogging?: boolean;

    /**
     * Custom log handler for debug events.
     * If provided, called in addition to console logging.
     */
    onDebugLog?: (event: DebugLogEvent) => void;

    /**
     * Maximum depth for nested actions within a single execution turn.
     * Defaults to 20 if not specified.
     */
    maxActionDepth?: number;
}

/**
 * Types of debug log events
 */
export type DebugLogEventType =
    | 'block-wrapped'
    | 'block-mount'
    | 'block-next'
    | 'block-unmount'
    | 'block-dispose'
    | 'stack-push'
    | 'stack-pop'
    | 'memory-allocate'
    | 'memory-release'
    | 'event-handled';

/**
 * Debug log event structure
 */
export interface DebugLogEvent {
    type: DebugLogEventType;
    timestamp: number;
    blockKey?: string;
    blockType?: string;
    details?: Record<string, unknown>;
}

/**
 * Default runtime options
 */
export const DEFAULT_RUNTIME_OPTIONS: Required<Omit<IRuntimeOptions, 'blockWrapperFactory' | 'onDebugLog' | 'defaultTestableConfig'>> = {
    debugMode: false,
    enableLogging: false,
    maxActionDepth: 20,
};



export interface RuntimeStackWrapper {
    wrap?: (block: IRuntimeBlock, parent?: IRuntimeBlock) => IRuntimeBlock;
    cleanup?: (block: IRuntimeBlock) => void;
}

export interface RuntimeStackLogger {
    debug?: (message: string, details?: Record<string, unknown>) => void;
    error?: (message: string, error: unknown, details?: Record<string, unknown>) => void;
}

export interface RuntimeStackHooks {
    onBeforePush?: (block: IRuntimeBlock, parent?: IRuntimeBlock) => void;
    onAfterPush?: (block: IRuntimeBlock, parent?: IRuntimeBlock) => void;
    onBeforePop?: (block: IRuntimeBlock | undefined) => void;
    onAfterPop?: (block: IRuntimeBlock | undefined) => void;
    unregisterByOwner?: (ownerKey: string) => void;
}

export interface RuntimeStackOptions extends IRuntimeOptions {
    wrapper?: RuntimeStackWrapper;
    logger?: RuntimeStackLogger;
    hooks?: RuntimeStackHooks;
    analyticsOptions?: {
        effortResolver?: IEffortResolver;
        references?: ReferenceIndex;
        userProfile?: { vo2max?: number };
    };
    /**
     * Sound configuration for this run.
     *
     * `profiles` are the user's sound profiles, available for selection.
     * `noteProfileId` is the profile selected for the note as a whole — the
     * note-level `sound-{profile}` tag, resolved by the host before the
     * runtime starts. A block that names its own profile overrides it.
     *
     * With neither, blocks fall back to the default profile.
     */
    soundOptions?: {
        profiles?: readonly SoundProfile[];
        noteProfileId?: string;
    };
}
