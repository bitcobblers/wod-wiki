/**
 * RuntimeLogger - Centralized debug logging for the runtime engine.
 *
 * Enable/disable via:
 * - `RuntimeLogger.enable()` / `RuntimeLogger.disable()`
 * - `window.__WOD_DEBUG__ = true` in browser console
 * - the app settings debug toggle (playground DebugModeContext syncs both ways)
 *
 * Output is the paper format from the timer-surfaces prototype (tier 04,
 * `Kimi_Agent_WOD Timer UI Prototypes/app/index.html`): one line per state
 * change — `HH:MM:SS.mmm  EVNT  subject…24  payload` — with the event code
 * tinted as a bonus layer. Color never carries information the columns
 * don't; a plain copy-paste stays aligned. See `RuntimeLogFormat`.
 *
 * Logs:
 * - Boot (runtime construction)
 * - Block push/pop
 * - `next()` calls and events that produce actions
 * - Output statements (segment / milestone)
 * - Memory updates
 */

import { IRuntimeBlock } from './contracts/IRuntimeBlock';
import { IRuntimeBehavior } from './contracts/IRuntimeBehavior';
import { IRuntimeAction } from './contracts/IRuntimeAction';
import { IEvent } from './contracts/events/IEvent';
import {
    formatRuntimeTimestamp,
    padRuntimeLogEvent,
    padRuntimeLogSubject,
    formatRuntimeLogRule,
} from './RuntimeLogFormat';

/** Well-known debug globals this module installs on the browser window. */
interface DebugWindow {
    __WOD_DEBUG__?: boolean;
    RuntimeLogger?: unknown;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RuntimeLogEntry {
    timestamp: Date;
    level: LogLevel;
    category: string;
    message: string;
    data?: Record<string, unknown>;
}

/** Minimal shape of an output statement for logging — structural on purpose
 *  so the logger stays dependency-light (no core import). */
export interface LoggableOutput {
    outputType: string;
    label?: string;
}

// Event-code hues, straight from the prototype's console palette:
// push violet, pop muted, next ochre, out green, time slate, halt red.
type EventCode = 'BOOT' | 'PUSH' | 'POP' | 'NEXT' | 'EVNT' | 'OUT' | 'MEM' | 'TIME' | 'HALT' | 'WARN' | 'ERR';

class RuntimeLoggerImpl {
    // Console is this logger's designated output sink; all writes funnel
    // through this single reference so the no-console rule is waived once.
    // eslint-disable-next-line no-console
    private readonly _console = console;
    private _enabled = false;
    private _history: RuntimeLogEntry[] = [];
    private _maxHistory = 500;

    private readonly EVENT_STYLES: Record<EventCode, string> = {
        BOOT: 'color: #3b82f6; font-weight: bold',  // primary
        PUSH: 'color: #a855f7; font-weight: bold',  // rounds violet
        POP: 'color: #64748b',                      // muted
        NEXT: 'color: #b45309; font-weight: bold',  // action ochre
        EVNT: 'color: #a855f7; font-weight: bold',  // violet
        OUT: 'color: #16a34a; font-weight: bold',   // effort green
        MEM: 'color: #f59e0b',                      // amber
        TIME: 'color: #3b82f6; font-weight: bold',  // time slate
        HALT: 'color: #ef4444; font-weight: bold',  // destructive
        WARN: 'color: #f59e0b; font-weight: bold',
        ERR: 'color: #ef4444; font-weight: bold',
    };

    constructor() {
        // Check for global debug flag in browser
        if (typeof window !== 'undefined') {
            // window is the documented host for this debug flag.
            const debugWindow = window as unknown as DebugWindow;
            this._enabled = !!debugWindow.__WOD_DEBUG__;
        }
    }

    get enabled(): boolean {
        return this._enabled;
    }

    enable(): void {
        this._enabled = true;
        this.writeLine('BOOT', 'runtime:ready', 'logging enabled');
    }

    disable(): void {
        // Last line before the gate closes — visible even though _enabled
        // is about to be false, so the operator sees the transition.
        this.writeLine('HALT', 'runtime:logger', 'logging disabled');
        this._enabled = false;
    }

    getHistory(): RuntimeLogEntry[] {
        return [...this._history];
    }

    clearHistory(): void {
        this._history = [];
    }

    // ============================================================================
    // Logging Methods
    // ============================================================================

    /**
     * Log runtime construction. Called once by ScriptRuntime's constructor;
     * dropped when logging is disabled, so cheap to leave wired.
     */
    logBoot(detail?: string): void {
        if (!this._enabled) return;
        this.writeLine('BOOT', 'runtime:ready', detail);
    }

    /**
     * Log when a block is pushed onto the stack. `depth` is the 1-based
     * stack depth the block landed at (prototype's `dN` column).
     */
    logPush(block: IRuntimeBlock, parentKey?: string, depth?: number): void {
        if (!this._enabled) return;

        const behaviors = this.getBehaviorNames(block);
        const payload = [
            `d${depth ?? '?'}  ${block.blockType ?? 'block'}`,
            behaviors.length > 0 ? `behaviors [${behaviors.join(', ')}]` : undefined,
            parentKey ? `parent ${parentKey.slice(0, 8)}` : undefined,
        ].filter(Boolean).join(' · ');

        this.writeLine('PUSH', block.label || block.blockType || 'Block', payload);
        this.addToHistory('info', 'push', `PUSH ${block.label}`, {
            key: block.key.toString(),
            parentKey,
            behaviors,
            sourceIds: block.sourceIds,
        });
    }

    /**
     * Log when a block is popped from the stack. `depth` is the 1-based
     * depth the block occupied (prototype's `dN` column).
     */
    logPop(block: IRuntimeBlock, reason?: string, depth?: number): void {
        if (!this._enabled) return;

        this.writeLine('POP', block.label || block.blockType || 'Block', `d${depth ?? '?'}${reason ? '  ' + reason : ''}`);
        this.addToHistory('info', 'pop', `POP ${block.label}`, {
            key: block.key.toString(),
            reason,
        });
    }

    /**
     * Log when next() is called on a block
     */
    logNext(block: IRuntimeBlock, actions: IRuntimeAction[]): void {
        if (!this._enabled) return;

        // Only log if there are actions, per user request
        if (actions.length === 0) return;

        const actionNames = actions.map(a => a.type || a.constructor?.name || 'Action');
        this.writeLine('NEXT', block.label || 'Block', `${actionNames.length} action(s): [${actionNames.join(', ')}]`);
        this.addToHistory('info', 'next', `NEXT ${block.label}`, {
            key: block.key.toString(),
            actions: actionNames,
        });
    }

    /**
     * Log when an event produces actions
     */
    logEvent(event: IEvent, actions: IRuntimeAction[]): void {
        if (!this._enabled) return;

        // Skip tick events that produce no actions (per user request)
        if (actions.length === 0) return;

        const actionNames = actions.map(a => a.type || a.constructor?.name || 'Action');
        this.writeLine('EVNT', event.name, `${actionNames.length} action(s): [${actionNames.join(', ')}]`);
        this.addToHistory('info', 'event', `EVENT ${event.name}`, {
            eventName: event.name,
            eventData: event.data,
            actions: actionNames,
        });
    }

    /**
     * Log an output statement (segment / milestone). Called by ScriptRuntime
     * on every published output. 'system' outputs (sound cues etc.) and
     * label-less structural outputs (the boot 'load' statement) are skipped —
     * volume stays proportional to what the athlete did.
     */
    logOutput(output: LoggableOutput): void {
        if (!this._enabled) return;
        if (output.outputType !== 'segment' && output.outputType !== 'milestone') return;
        if (!output.label) return;

        this.writeLine('OUT', output.label, output.outputType);
        this.addToHistory('info', 'output', `OUT ${output.label ?? output.outputType}`, {
            outputType: output.outputType,
            label: output.label,
        });
    }

    /**
     * Log when memory is updated on a block
     */
    logMemoryUpdate(blockKey: string, memoryType: string, value: unknown): void {
        if (!this._enabled) return;

        // Create a simplified view of the value
        const displayValue = typeof value === 'object' && value !== null
            ? this.summarizeObject(value as unknown as Record<string, unknown>)
            : value;

        this.writeLine('MEM', memoryType, `[${blockKey.slice(0, 8)}] ${safeJson(displayValue)}`);
        this.addToHistory('debug', 'memory', `MEMORY ${memoryType}`, {
            blockKey,
            memoryType,
            value: displayValue,
        });
    }

    /**
     * Log action execution
     */
    logAction(action: IRuntimeAction, depth: number): void {
        if (!this._enabled) return;
        const actionName = action.type || action.constructor?.name || 'Action';
        this.writeLine('EVNT', actionName, `d${depth}`);
    }

    /**
     * General-purpose message log for runtime consumers.
     * Gates on _enabled; writes to the console sink and history.
     */
    logMessage(level: LogLevel, category: string, message: string, data?: Record<string, unknown>): void {
        if (!this._enabled) return;
        this.writeLine(level === 'error' ? 'ERR' : level === 'warn' ? 'WARN' : 'EVNT', category, message);
        this.addToHistory(level, category, message, data);
    }

    /**
     * Always-on variant of `logMessage`. Use sparingly for errors/warnings that
     * must be visible even when debug logging is disabled.
     */
    logAlways(level: LogLevel, category: string, message: string, data?: Record<string, unknown>): void {
        this.writeLine(level === 'error' ? 'ERR' : level === 'warn' ? 'WARN' : 'EVNT', category, message);
        this.addToHistory(level, category, message, data);
    }

    /** A round-boundary rule in the paper format (prototype tier 04). */
    logRule(label?: string): void {
        if (!this._enabled) return;
        this._console.log(`%c${formatRuntimeLogRule(label)}`, 'color: #94a3b8');
    }

    // ============================================================================
    // Helpers
    // ============================================================================

    /**
     * The one console write path: a single paper line with the event code
     * tinted. `addToHistory` stays separate — entries carry structured data,
     * lines carry display text.
     */
    private writeLine(code: EventCode, subject: string, payload?: string): void {
        const ts = formatRuntimeTimestamp(new Date());
        this._console.log(
            `${ts}  %c${padRuntimeLogEvent(code)}%c  ${padRuntimeLogSubject(subject)}${payload ? '  ' + payload : ''}`,
            this.EVENT_STYLES[code],
            'color: inherit',
        );
    }

    private getBehaviorNames(block: IRuntimeBlock): string[] {
        // Access behaviors via reflection if possible
        const blockWithBehaviors = block as unknown as { behaviors?: readonly IRuntimeBehavior[] };
        const behaviors = blockWithBehaviors.behaviors;
        if (!behaviors || !Array.isArray(behaviors)) return [];
        return behaviors.map(b => b.constructor?.name || 'Behavior');
    }

    private summarizeObject(obj: Record<string, unknown>): Record<string, unknown> {
        const summary: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(obj)) {
            if (Array.isArray(val)) {
                summary[key] = `[${val.length} items]`;
            } else if (typeof val === 'object' && val !== null) {
                summary[key] = '{...}';
            } else {
                summary[key] = val;
            }
        }
        return summary;
    }

    private addToHistory(level: LogLevel, category: string, message: string, data?: Record<string, unknown>): void {
        this._history.push({
            timestamp: new Date(),
            level,
            category,
            message,
            data,
        });

        // Trim history if too large
        if (this._history.length > this._maxHistory) {
            this._history = this._history.slice(-this._maxHistory);
        }
    }
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value) ?? '';
    } catch {
        return String(value);
    }
}

// Singleton instance
export const RuntimeLogger = new RuntimeLoggerImpl();

// Make available on window for easy debugging
if (typeof window !== 'undefined') {
    // window is the documented host for runtime debug tooling.
    (window as unknown as DebugWindow).RuntimeLogger = RuntimeLogger;
}
