import { EditorView, keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

function parseTimeString(timeStr: string): [number, number, number, number] | null {
  const parts = timeStr.split(':');
  if (parts.length < 1 || parts.length > 4) return null;
  const numbers = parts.map((p) => parseInt(p, 10));
  if (numbers.some((n) => isNaN(n))) return null;
  while (numbers.length < 4) {
    numbers.unshift(0);
  }
  return numbers as [number, number, number, number];
}

function formatTimeString(days: number, hours: number, minutes: number, seconds: number): string {
  const parts: number[] = [];
  if (days > 0) {
    parts.push(days, hours, minutes, seconds);
  } else if (hours > 0) {
    parts.push(hours, minutes, seconds);
  } else if (minutes > 0) {
    parts.push(minutes, seconds);
  } else {
    parts.push(seconds);
  }
  return parts.map((p, i) => (i === 0 ? String(p) : String(p).padStart(2, '0'))).join(':');
}

function incrementTime(
  days: number,
  hours: number,
  minutes: number,
  seconds: number,
  digitIndex: number,
  delta: number,
): [number, number, number, number] {
  let totalSeconds = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  const multipliers = [86400, 3600, 60, 1];
  const step = multipliers[digitIndex] ?? 1;

  totalSeconds = Math.max(0, totalSeconds + delta * step);

  const d = Math.floor(totalSeconds / 86400);
  totalSeconds %= 86400;
  const h = Math.floor(totalSeconds / 3600);
  totalSeconds %= 3600;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;

  return [d, h, m, s];
}

function findTimeAtCursor(
  line: string,
  column: number,
): { timeStr: string; startCol: number; endCol: number; digitIndex: number } | null {
  const timeRegex = /\b(\d{1,2}(?::\d{2}){1,3})\b/g;
  let match: RegExpExecArray | null;

  while ((match = timeRegex.exec(line)) !== null) {
    const startCol = match.index;
    const endCol = startCol + match[0].length;

    if (column >= startCol && column <= endCol) {
      const timeStr = match[0];
      const cursorOffset = Math.min(column - startCol, timeStr.length - 1);
      const colonCount = (timeStr.slice(0, cursorOffset).match(/:/g) || []).length;
      const totalColons = (timeStr.match(/:/g) || []).length;
      const digitIndex = 4 - (totalColons + 1) + colonCount;

      return { timeStr, startCol, endCol, digitIndex };
    }
  }

  return null;
}

function stepDecimalString(current: number, step: number, delta: number, decimals: number): string {
  const next = Math.max(0, current + delta * step);
  const rounded = decimals > 0 ? Math.round(next * 10) / 10 : Math.round(next);
  return String(rounded);
}

function findTokenFallbackAtCursor(
  line: string,
  column: number,
  delta: number,
): { startCol: number; endCol: number; replacement: string } | null {
  const resRe = /(@?)(\d+(?:\.\d+)?)\s*(kg|lbs?|pood|%)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = resRe.exec(line)) !== null) {
    const startCol = m.index;
    const endCol = startCol + m[0].length;
    if (column >= startCol && column <= endCol) {
      const prefix = m[1];
      const current = parseFloat(m[2]);
      const unit = m[3];
      const lowerUnit = unit.toLowerCase();
      const step = lowerUnit === '%' ? 1 : lowerUnit === 'pood' ? 0.5 : current >= 20 ? 5 : 2.5;
      const decimals = m[2].includes('.') || step % 1 !== 0 ? 1 : 0;
      const gap = m[0].slice(prefix.length + m[2].length, m[0].length - unit.length);
      return {
        startCol,
        endCol,
        replacement: `${prefix}${stepDecimalString(current, step, delta, decimals)}${gap}${unit}`,
      };
    }
  }

  const roundsRe = /\((\d+)\)/g;
  while ((m = roundsRe.exec(line)) !== null) {
    const startCol = m.index;
    const endCol = startCol + m[0].length;
    if (column >= startCol && column <= endCol) {
      const next = Math.max(1, parseInt(m[1], 10) + delta);
      return { startCol, endCol, replacement: `(${next})` };
    }
  }

  const repRe = /\b(\d+)\b/g;
  while ((m = repRe.exec(line)) !== null) {
    const startCol = m.index;
    const endCol = startCol + m[0].length;
    if (column < startCol || column > endCol) continue;
    const prevCh = startCol > 0 ? line[startCol - 1] : '';
    const nextCh = endCol < line.length ? line[endCol] : '';
    if (/[:/.xX-]/.test(prevCh) || /[:/.xX-]/.test(nextCh)) continue;
    const next = Math.max(1, parseInt(m[1], 10) + delta);
    return { startCol, endCol, replacement: String(next) };
  }

  return null;
}

function handleSmartIncrement(view: EditorView, delta: number): boolean {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const col = sel.head - line.from;

  const found = findTimeAtCursor(line.text, col);
  if (found) {
    const parsed = parseTimeString(found.timeStr);
    if (!parsed) return false;

    const [d, h, m, s] = incrementTime(parsed[0], parsed[1], parsed[2], parsed[3], found.digitIndex, delta);
    const nextTime = formatTimeString(d, h, m, s);

    view.dispatch({
      changes: {
        from: line.from + found.startCol,
        to: line.from + found.endCol,
        insert: nextTime,
      },
    });
    return true;
  }

  const fallback = findTokenFallbackAtCursor(line.text, col, delta);
  if (!fallback) return false;

  const nextCursor = Math.min(
    line.from + fallback.startCol + fallback.replacement.length,
    line.from + fallback.startCol + Math.max(1, col - fallback.startCol),
  );
  view.dispatch({
    changes: {
      from: line.from + fallback.startCol,
      to: line.from + fallback.endCol,
      insert: fallback.replacement,
    },
    selection: { anchor: nextCursor },
  });
  return true;
}

export const smartIncrement: Extension = keymap.of([
  {
    key: "Alt-ArrowUp",
    run: (view) => handleSmartIncrement(view, 1),
  },
  {
    key: "Alt-ArrowDown",
    run: (view) => handleSmartIncrement(view, -1),
  },
]);
