/**
 * RuntimeLogFormat — paper-output formatting for runtime debug logs.
 *
 * Design: Kimi_Agent_WOD Timer UI Prototypes/app/index.html, tier 04
 * (Debug output). Fixed columns — `HH:MM:SS.mmm`, a 5-char event code, a
 * 24-char subject, then the payload — so one line carries one state change
 * and a plain copy-paste into an issue stays readable without color. The
 * logger tints the event code as a bonus layer; alignment never depends on
 * it.
 */

/** Width of the subject column (prototype: 24 chars, padded). */
export const RUNTIME_LOG_SUBJECT_WIDTH = 24;

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad3 = (n: number): string => String(n).padStart(3, '0');

/** `HH:MM:SS.mmm` — fixed-width so lines always align. */
export function formatRuntimeTimestamp(d: Date): string {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

/** Event code fixed at 5 chars. Exported so the logger can color the code
 *  inside a `%c`-styled console line without rebuilding the padding. */
export function padRuntimeLogEvent(event: string): string {
    return (event + '     ').slice(0, 5);
}

/** Subject fixed at 24 chars, same rationale as the event pad. */
export function padRuntimeLogSubject(subject: string): string {
    return (subject + ' '.repeat(RUNTIME_LOG_SUBJECT_WIDTH)).slice(0, RUNTIME_LOG_SUBJECT_WIDTH);
}

/**
 * One paper line: `HH:MM:SS.mmm  EVNT  subject…24  payload`.
 * The event code is padded/truncated to 5 chars, the subject to 24.
 */
export function formatRuntimeLogLine(timestamp: Date, event: string, subject: string, payload?: string): string {
    return `${formatRuntimeTimestamp(timestamp)}  ${padRuntimeLogEvent(event)}  ${padRuntimeLogSubject(subject)}${payload ? '  ' + payload : ''}`;
}

/**
 * Structural rule. With a label: `────── label ──────` centered in a
 * 52-char rule; without: a plain 52-char rule.
 */
export function formatRuntimeLogRule(label?: string): string {
    const width = 52;
    if (!label) return '─'.repeat(width);
    const inner = ` ${label} `;
    const left = Math.max(0, Math.floor((width - inner.length) / 2));
    const right = Math.max(0, width - inner.length - left);
    return `${'─'.repeat(left)}${inner}${'─'.repeat(right)}`;
}
