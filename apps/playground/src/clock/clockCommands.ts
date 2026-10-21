/**
 * clockCommands — the shared clock command-board contract.
 *
 * One registry, one foreground authority. A mounted `useClockController`
 * registers a snapshot + command handler; the highest-priority (ties: most
 * recently registered) controller is the authority. Every command source —
 * browser keyboard, touch, legacy Cast handles, receiver RPC — funnels
 * through `dispatchClockCommand`, so paused/required/completed gates hold no
 * matter who asks. The snapshot is a serializable projection: no runtime
 * objects, no metric origin state.
 *
 * Priorities: browser live 0 · CollectionWizard pre-run 10 · FullscreenTimer
 * post-run/review 20. Nested controllers are real use cases (fullscreen clock
 * over the inline editor clock) — the registry hands authority back
 * automatically when the higher-priority controller unmounts.
 */

// ── Types ────────────────────────────────────────────────────────────────

export type ClockPhase = 'ready' | 'live' | 'collection' | 'review';
export type ClockStatus = 'idle' | 'running' | 'paused' | 'completed';
export type ClockEntryDomain = 'integer' | 'decimal' | 'duration' | 'choice';

export type ClockCommand =
  | { kind: 'next' }
  | { kind: 'playback' }
  | { kind: 'stop-request' }
  | { kind: 'stop-confirm' }
  | { kind: 'stop-cancel' }
  | { kind: 'values-open' }
  | { kind: 'entry-cancel' }
  | { kind: 'entry-save'; fieldId: string; value: number }
  | { kind: 'entry-skip'; fieldId: string }
  | { kind: 'reps-adjust'; occurrenceId: string; delta: 1 | -1 }
  | { kind: 'reps-set'; occurrenceId: string; value: number }
  | { kind: 'reps-select'; occurrenceId: string }
  | { kind: 'choice-select'; fieldId: string; index: number }
  | { kind: 'ready-start' }
  | { kind: 'dismiss' };

export interface ClockEntry {
  fieldId: string;
  label: string;
  metricType: string;
  domain: ClockEntryDomain;
  intent: 'target' | 'actual';
  required: boolean;
  value: number | null;
  unit: string;
  index: number;
  total: number;
  alternatives?: Array<{ label: string; value: number }>;
  /** Choice-domain highlight (coordinated addition, CollectionFlow consumer). */
  selectedIndex?: number;
}

export interface ClockRepState {
  occurrenceId: string;
  label: string;
  actual: number | null;
  target: number | null;
}

export interface ClockSnapshot {
  runId: string;
  phase: ClockPhase;
  status: ClockStatus;
  canNext: boolean;
  canStop: boolean;
  stopRequested: boolean;
  reps: ClockRepState[];
  selectedOccurrenceId: string | null;
  entry: ClockEntry | null;
  error: string | null;
  saving: boolean;
}

const COMMAND_KINDS = [
  'next', 'playback', 'stop-request', 'stop-confirm', 'stop-cancel',
  'values-open', 'entry-cancel', 'entry-save', 'entry-skip',
  'reps-adjust', 'reps-set', 'reps-select', 'choice-select',
  'ready-start', 'dismiss',
] as const;

/** Boundary validation for transport-delivered payloads (Cast RPC). */
export function isClockCommand(value: unknown): value is ClockCommand {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !(COMMAND_KINDS as readonly string[]).includes(kind)) return false;
  const cmd = value as Record<string, unknown>;
  switch (kind) {
    case 'entry-save':
      return typeof cmd.fieldId === 'string' && typeof cmd.value === 'number' && Number.isFinite(cmd.value);
    case 'entry-skip':
      return typeof cmd.fieldId === 'string';
    case 'reps-select':
      return typeof cmd.occurrenceId === 'string';
    case 'reps-adjust':
      return typeof cmd.occurrenceId === 'string' && (cmd.delta === 1 || cmd.delta === -1);
    case 'reps-set':
      return typeof cmd.occurrenceId === 'string'
        && typeof cmd.value === 'number' && Number.isSafeInteger(cmd.value) && cmd.value >= 0;
    case 'choice-select':
      return typeof cmd.fieldId === 'string' && typeof cmd.index === 'number' && Number.isInteger(cmd.index);
    default:
      return true;
  }
}

/** Fresh, collision-free run identifier for one execution instance. */
let runIdCounter = 0;
export function createClockRunId(): string {
  runIdCounter += 1;
  return `run-${Date.now().toString(36)}-${runIdCounter}`;
}

// ── Registry ─────────────────────────────────────────────────────────────

interface Registration {
  id: number;
  priority: number;
  seq: number;
  snapshot: ClockSnapshot | null;
  handler: (command: ClockCommand) => boolean;
  keyboard: boolean;
}

const controllers = new Map<number, Registration>();
let nextControllerId = 1;
let nextSeq = 1;
const clockListeners = new Set<() => void>();
let currentSnapshot: ClockSnapshot | null = null;
let currentAuthorityId: number | null = null;

function getAuthority(): Registration | null {
  let best: Registration | null = null;
  for (const c of controllers.values()) {
    // Null-snapshot controllers are placeholders (runtime not ready yet);
    // they never own dispatch.
    if (c.snapshot === null) continue;
    if (!best || c.priority > best.priority || (c.priority === best.priority && c.seq > best.seq)) {
      best = c;
    }
  }
  return best;
}

/** Recompute the projected snapshot; notify only on observable change. */
function refresh(): void {
  const authority = getAuthority();
  const next = authority?.snapshot ?? null;
  const authorityChanged = (authority?.id ?? null) !== currentAuthorityId;
  const snapshotChanged = next !== currentSnapshot;
  currentSnapshot = next;
  currentAuthorityId = authority?.id ?? null;
  syncDraftToEntry(next?.entry ?? null);
  if (snapshotChanged || authorityChanged) {
    for (const l of clockListeners) l();
  }
  syncKeyboardListener();
}

export function getClockSnapshot(): ClockSnapshot | null {
  return currentSnapshot;
}

export function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  return () => clockListeners.delete(listener);
}

export function dispatchClockCommand(runId: string, command: ClockCommand): boolean {
  const authority = getAuthority();
  const snapshot = authority?.snapshot;
  if (!authority || !snapshot) return false;
  if (snapshot.runId !== runId) return false;
  try {
    return authority.handler(command) === true;
  } catch {
    return false;
  }
}

/** True when the given controller id currently owns dispatch. */
export function isClockAuthority(id: number): boolean {
  const authority = getAuthority();
  return authority !== null && authority.id === id;
}

// ── Controller registration (internal — consumed by useClockController) ──

export interface ClockControllerInput {
  snapshot: ClockSnapshot | null;
  handler: (command: ClockCommand) => boolean;
  priority: number;
  keyboard: boolean;
}

/** Registers a controller identity; returns its id. */
export function registerClockController(input: ClockControllerInput): number {
  const id = nextControllerId++;
  controllers.set(id, { id, seq: nextSeq++, ...input });
  refresh();
  return id;
}

/** Replaces the stored input for an existing identity and republishes. */
export function updateClockController(id: number, input: ClockControllerInput): void {
  const existing = controllers.get(id);
  if (!existing) return;
  controllers.set(id, { ...existing, ...input });
  refresh();
}

/** Removes exactly this identity; authority falls back to the next controller. */
export function unregisterClockController(id: number): void {
  if (controllers.delete(id)) refresh();
}

// ── Draft store (keyboard-owned digit buffer for entry / quick rep entry) ──
// The shared keyboard listener owns the draft because it owns the digit keys;
// the board renders it. Cleared whenever entry state changes or a commit is
// accepted.

let draft = '';
let draftError: string | null = null;
const draftListeners = new Set<() => void>();
let draftFieldId: string | null = null;

function notifyDraft(): void {
  for (const l of draftListeners) l();
}

export function getClockDraft(): string {
  return draft;
}

export function getClockDraftError(): string | null {
  return draftError;
}

export function subscribeClockDraft(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => draftListeners.delete(listener);
}

/** Internal — shared keyboard buffer edits. */
function setClockDraft(text: string, error: string | null = null): void {
  if (draft === text && draftError === error) return;
  draft = text;
  draftError = error;
  notifyDraft();
}

/** UI-side buffer write (on-screen entry grids report their edits here). */
export function writeClockDraft(text: string): void {
  setClockDraft(text);
}

/** Reset the draft when the entry target changes or entry closes. */
function syncDraftToEntry(entry: ClockEntry | null): void {
  const fieldId = entry?.fieldId ?? null;
  if (fieldId !== draftFieldId) {
    draftFieldId = fieldId;
    setClockDraft('');
  }
}

// ── Draft → value parsing (shared by keyboard commit and board Save) ─────

/**
 * Canonical draft editor — ONE implementation for the keyboard listener and
 * ClockValueEntry's on-screen grid. Duration digits fill seconds first, then
 * minutes in an explicit `M:SS` buffer; direct edits preserve the delimiter.
 * Decimal accepts a single separator; other numeric digits append.
 */
export function applyEntryKey(domain: ClockEntryDomain, draft: string, key: string): string {
  if (key === 'clear') return '';
  if (key === 'back') {
    const digits = domain === 'duration' ? draft.replace(':', '').slice(0, -1) : draft.slice(0, -1);
    return domain === 'duration' && digits.length > 2 ? `${digits.slice(0, -2)}:${digits.slice(-2)}` : digits;
  }
  if (domain === 'duration') {
    if (!/^\d$/.test(key)) return draft;
    const digits = draft.split(':').join('');
    if (!/^\d{0,4}$/.test(digits + key)) return draft; // M:SS capacity reached
    const next = digits + key;
    return next.length <= 2 ? next : `${next.slice(0, -2)}:${next.slice(-2)}`;
  }
  if (domain === 'decimal' && key === '.') {
    return draft.includes('.') ? draft : draft + '.';
  }
  if (domain === 'decimal' && key === '-') return draft; // signed handled by domain limits elsewhere
  return /^\d$/.test(key) ? draft + key : draft;
}

export type DraftParseResult = { ok: true; value: number } | { ok: false; error: string };

/**
 * Interpret a draft string for a field domain. Duration digits are MMSS
 * (minutes then seconds, explicit on-screen format — never "130 = ?").
 * Integer allows explicit zero; decimal must stay finite.
 */
export function parseClockDraftValue(draftText: string, domain: ClockEntryDomain): DraftParseResult {
  const text = draftText.trim();
  if (text.length === 0) return { ok: false, error: 'Enter a value' };
  switch (domain) {
    case 'integer': {
      if (!/^\d+$/.test(text)) return { ok: false, error: 'Whole number required' };
      const value = Number.parseInt(text, 10);
      return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false, error: 'Number too large' };
    }
    case 'decimal': {
      if (!/^\d*\.?\d*$/.test(text) || !/\d/.test(text)) return { ok: false, error: 'Invalid number' };
      const value = Number.parseFloat(text);
      return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: 'Invalid number' };
    }
    case 'duration': {
      const parts = /^(\d*):(\d{0,2})$/.exec(text);
      if (text.includes(':') && (!parts || !/\d/.test(text))) return { ok: false, error: 'Use minutes and seconds' };
      if (!parts && !/^\d{1,4}$/.test(text)) return { ok: false, error: 'Use minutes and seconds' };
      const minutes = Number(parts ? parts[1] || '0' : text.slice(0, -2) || '0');
      const seconds = Number(parts ? parts[2] || '0' : text.slice(-2));
      if (seconds > 59) return { ok: false, error: 'Seconds must be 0–59' };
      const value = (minutes * 60 + seconds) * 1000;
      return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false, error: 'Duration too large' };
    }
    case 'choice':
      return { ok: false, error: 'Pick an option' };
  }
}

// ── Key classification (shared with the Cast receiver) ───────────────────

export type ClockKeyMode = 'navigation' | 'keypad';

const KEY_MODE_STORAGE_KEY = 'wodwiki.clock.keyMode';

export function getClockKeyMode(): ClockKeyMode {
  try {
    return window.localStorage.getItem(KEY_MODE_STORAGE_KEY) === 'keypad' ? 'keypad' : 'navigation';
  } catch {
    return 'navigation';
  }
}

export function setClockKeyMode(mode: ClockKeyMode): void {
  try {
    window.localStorage.setItem(KEY_MODE_STORAGE_KEY, mode);
  } catch {
    // Private mode etc. — mode stays session-local.
  }
}

export type ClockDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Raw physical classification, NumLock-independent. Numpad arrow codes
 * (`Numpad8` etc.) classify as their digit with `fromNumpad: true`, even when
 * Num Lock off delivers `key === 'ArrowUp'`. Main-keyboard digits report
 * `fromNumpad: false`.
 */
export type RawClockKey =
  | { type: 'digit'; digit: string; fromNumpad: boolean }
  | { type: 'direction'; direction: ClockDirection }
  | { type: 'enter'; keypad: boolean }
  | { type: 'decimal' }
  | { type: 'plus' }
  | { type: 'minus' }
  | { type: 'values' }
  | { type: 'playback' }
  | { type: 'backspace' }
  | { type: 'escape' }
  | { type: 'other' };

const NUMPAD_DIGIT_CODES: Record<string, string> = {
  Numpad0: '0', Numpad1: '1', Numpad2: '2', Numpad3: '3', Numpad4: '4',
  Numpad5: '5', Numpad6: '6', Numpad7: '7', Numpad8: '8', Numpad9: '9',
};

const DIRECTION_DIGITS: Record<string, ClockDirection> = {
  '8': 'up', '2': 'down', '4': 'left', '6': 'right',
};

export function classifyClockKey(key: string, code: string | undefined, location: number | undefined): RawClockKey {
  const numpadDigit = code ? NUMPAD_DIGIT_CODES[code] : undefined;
  if (numpadDigit) return { type: 'digit', digit: numpadDigit, fromNumpad: true };
  switch (code) {
    case 'NumpadEnter':
      return { type: 'enter', keypad: true };
    case 'NumpadAdd':
      return { type: 'plus' };
    case 'NumpadSubtract':
      return { type: 'minus' };
    case 'NumpadDecimal':
      return { type: 'decimal' };
    case 'NumpadMultiply':
      return { type: 'values' };
    case 'NumpadDivide':
      return { type: 'playback' };
    case 'Backspace':
      return { type: 'backspace' };
  }
  if (key === 'Enter' && location === 3) return { type: 'enter', keypad: true };
  switch (key) {
    case 'ArrowUp': return { type: 'direction', direction: 'up' };
    case 'ArrowDown': return { type: 'direction', direction: 'down' };
    case 'ArrowLeft': return { type: 'direction', direction: 'left' };
    case 'ArrowRight': return { type: 'direction', direction: 'right' };
    case 'Enter': return { type: 'enter', keypad: false };
    case 'MediaPlayPause': return { type: 'playback' };
    case 'Escape': return { type: 'escape' };
    case '+': return { type: 'plus' };
    case '-': return { type: 'minus' };
    case '*': return { type: 'values' };
    case '/': return { type: 'playback' };
    case '.': case ',': return { type: 'decimal' };
    case 'Backspace': case 'Clear': return { type: 'backspace' };
  }
  if (/^[0-9]$/.test(key)) return { type: 'digit', digit: key, fromNumpad: false };
  return { type: 'other' };
}

/** Resolved intent after applying the entry/live context and key mode. */
export type ClockKeyAction =
  | { kind: 'direction'; direction: ClockDirection }
  | { kind: 'digit'; digit: string }
  /** Context primary command: Next live, commit draft during entry, dismiss at review. */
  | { kind: 'primary'; ambiguous?: boolean }
  /** Activate the focused control (native click). Navigation-mode main Enter. */
  | { kind: 'select' }
  | { kind: 'playback' }
  | { kind: 'reps-adjust'; delta: 1 | -1 }
  | { kind: 'values' }
  /** Backspace editing (entry draft). */
  | { kind: 'back' }
  /** Escape — cancel draft / open stop confirmation / dismiss, per context. */
  | { kind: 'cancel' }
  | { kind: 'none' };

/**
 * User amendment: on the live clock, `8`/`2`/`4`/`6` — numpad or printable —
 * navigate like their arrow labels regardless of Num Lock; during value entry
 * every digit (including those four, Num Lock on or off) is data.
 *
 * Shared with the Cast receiver (`useSpatialNavigation`). Callers check
 * `e.repeat` (ignore for mutations) and Ctrl/Alt/Meta/composition themselves.
 */
export function normalizeClockKey(
  e: { key: string; code?: string; location?: number; keyCode?: number },
  ctx?: { entryOpen?: boolean; mode?: ClockKeyMode },
): ClockKeyAction {
  // Media keys: some remotes/keypads deliver only keyCode (179 play/pause,
  // 126 play, 127 pause).
  if (e.keyCode === 179 || e.keyCode === 126 || e.keyCode === 127) return { kind: 'playback' };
  if (e.key === 'Select' || e.key === 'Accept' || e.key === 'DPAD_CENTER' || e.keyCode === 23) return { kind: 'select' };
  if (e.key === 'GoBack' || e.key === 'BrowserBack' || e.key === 'Back' || e.keyCode === 4 || e.keyCode === 461 || e.keyCode === 10009) return { kind: 'cancel' };
  const raw = classifyClockKey(e.key, e.code, e.location);
  const context = { entryOpen: ctx?.entryOpen === true, mode: ctx?.mode ?? getClockKeyMode() };
  switch (raw.type) {
    case 'digit': {
      if (context.entryOpen) return { kind: 'digit', digit: raw.digit };
      const direction = DIRECTION_DIGITS[raw.digit];
      // Direct main-digit navigation is acceptable live (user amendment);
      // non-direction digits seed a draft.
      return direction ? { kind: 'direction', direction } : { kind: 'digit', digit: raw.digit };
    }
    case 'direction':
      return { kind: 'direction', direction: raw.direction };
    case 'enter':
      if (raw.keypad) return { kind: 'primary' };
      // Ambiguous main Enter: Keypad mode reads it as the primary command,
      // Navigation mode keeps focused-selection semantics.
      return context.mode === 'keypad' ? { kind: 'primary', ambiguous: true } : { kind: 'select' };
    case 'decimal':
      return context.entryOpen ? { kind: 'digit', digit: '.' } : { kind: 'none' };
    case 'plus': return { kind: 'reps-adjust', delta: 1 };
    case 'minus': return { kind: 'reps-adjust', delta: -1 };
    case 'values': return { kind: 'values' };
    case 'playback': return { kind: 'playback' };
    case 'backspace':
      return context.entryOpen ? { kind: 'back' } : { kind: 'none' };
    case 'escape':
      return { kind: 'cancel' };
    case 'other':
      return { kind: 'none' };
  }
}

// ── Keyboard listener (installed once while any controller opts in) ──────

function isInteractiveElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'A'
    || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'option'
    || (el as HTMLElement).isContentEditable;
}

function moveClockFocus(direction: ClockDirection): boolean {
  const root = document.querySelector('[data-clock-entry]') ?? document.querySelector('[data-clock-panel]');
  if (!root) return false;
  const focusables = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (focusables.length === 0) return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active || !root.contains(active) || !focusables.includes(active)) {
    focusables[0]!.focus();
    return true;
  }
  const ar = active.getBoundingClientRect();
  const ax = ar.left + ar.width / 2;
  const ay = ar.top + ar.height / 2;
  const axis: Record<ClockDirection, { primary: 'x' | 'y'; sign: 1 | -1 }> = {
    right: { primary: 'x', sign: 1 },
    left: { primary: 'x', sign: -1 },
    down: { primary: 'y', sign: 1 },
    up: { primary: 'y', sign: -1 },
  };
  const { primary, sign } = axis[direction];
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of focusables) {
    if (el === active) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2 - ax;
    const cy = r.top + r.height / 2 - ay;
    const along = primary === 'x' ? cx : cy;
    const cross = primary === 'x' ? cy : cx;
    if (along * sign <= 2) continue;
    const score = Math.abs(along) + 2 * Math.abs(cross);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus();
    return true;
  }
  return false;
}

function commitDraftToEntry(snapshot: ClockSnapshot, handler: (c: ClockCommand) => boolean): boolean {
  const entry = snapshot.entry;
  if (!entry) return false;
  if (entry.domain === 'choice') return false; // choice commits via choice-select
  const parsed = parseClockDraftValue(draft, entry.domain);
  if (parsed.ok === false) {
    setClockDraft(draft, parsed.error);
    return true; // consumed; error surfaced on the board, draft preserved
  }
  // Dispatch only — the draft is NOT cleared here: the handler's `true` means
  // "accepted", not "settled". The entry owner clears the shared draft when
  // the save actually confirms (a failed async save must keep the draft).
  return handler({ kind: 'entry-save', fieldId: entry.fieldId, value: parsed.value });
}

function isForeignTextInput(target: Element | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const editable =
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  if (!editable) return false;
  // Entry-owned inputs (ClockValueEntry and friends) live inside the clock
  // panel or the entry card and are handled by their own delegation below.
  return el.closest('[data-clock-panel]') === null && el.closest('[data-clock-entry]') === null;
}

function handleClockKeyDown(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const authority = getAuthority();
  if (!authority || !authority.keyboard) return;
  const snapshot = authority.snapshot;
  if (snapshot === null) return;
  if (snapshot.status === 'completed' && snapshot.phase !== 'review') return;

  const target = e.target as Element | null;
  // Editors, search fields and unrelated form inputs keep their keys.
  if (isForeignTextInput(target)) return;

  const entry = snapshot.entry;
  // The entry card's own input/buttons own their keys (Enter saves, grid
  // clicks edit); the global listener must not double-dispatch behind them.
  if (entry !== null && target !== null && target.closest('[data-clock-entry]') !== null) return;
  // A modal owned by the board itself (key check) swallows everything.
  if (document.body.dataset.clockModal !== undefined && document.body.dataset.clockModal !== '') return;

  syncDraftToEntry(entry);
  const resolved = normalizeClockKey(e, { entryOpen: entry !== null });
  if (resolved.kind === 'none') return;

  // Held-key repeats: draft digits/backspace may repeat (editing); every
  // other recognized key is a mutation — suppress the native repeat (held
  // Enter on a focused control would machine-gun clicks) and ignore.
  if (e.repeat && resolved.kind !== 'digit' && resolved.kind !== 'back') {
    if (isInteractiveElement(target) || keypadEnterEvent(e)) e.preventDefault();
    return;
  }

  const handler = authority.handler;
  let consumed = false;
  // An unambiguous keypad Enter always belongs to the clock: even when the
  // gate rejects the command (paused Next), the native focused-button
  // activation must not fire instead — that would be a second, ungated
  // mutation path.
  const keypadEnter = keypadEnterEvent(e);

  switch (resolved.kind) {
    case 'primary': {
      if (resolved.ambiguous) {
        // Ambiguous main Enter is the primary command only when the clock
        // command area owns focus; focused interactive controls keep native
        // activation (single native click, not ours).
        if (isInteractiveElement(document.activeElement)) break;
        const panel = document.querySelector('[data-clock-panel]');
        const active = document.activeElement;
        const inClock = !active || active === document.body || (panel !== null && panel.contains(active));
        if (!inClock) break;
      }
      // Confirmation dialog takes priority over everything behind it.
      if (snapshot.stopRequested) {
        consumed = handler({ kind: 'stop-confirm' });
        break;
      }
      if (entry) {
        consumed = commitDraftToEntry(snapshot, handler);
        break;
      }
      if (snapshot.phase === 'review') {
        consumed = handler({ kind: 'dismiss' });
        break;
      }
      if (snapshot.status === 'idle' && snapshot.phase !== 'collection') {
        consumed = handler({ kind: 'ready-start' });
        break;
      }
      consumed = handler({ kind: 'next' });
      break;
    }
    case 'playback':
      consumed = handler({ kind: 'playback' });
      break;
    case 'direction':
      consumed = moveClockFocus(resolved.direction);
      break;
    case 'reps-adjust':
      if (!entry) consumed = handler({
        kind: 'reps-adjust',
        occurrenceId: snapshot.selectedOccurrenceId ?? '',
        delta: resolved.delta,
      });
      break;
    case 'values':
      if (!entry) consumed = handler({ kind: 'values-open' });
      break;
    case 'cancel':
      if (snapshot.stopRequested) {
        consumed = handler({ kind: 'stop-cancel' });
      } else if (entry) {
        consumed = handler({ kind: 'entry-cancel' });
      } else if (snapshot.status === 'running' || snapshot.status === 'paused') {
        consumed = handler({ kind: 'stop-request' });
      } else if (snapshot.phase === 'review') {
        consumed = handler({ kind: 'dismiss' });
      }
      break;
    case 'back':
      setClockDraft(draft.slice(0, -1));
      consumed = true;
      break;
    case 'digit': {
      if (entry?.domain === 'choice') {
        const index = Number.parseInt(resolved.digit, 10) - 1;
        const alt = entry.alternatives?.[index];
        if (alt) consumed = handler({ kind: 'choice-select', fieldId: entry.fieldId, index });
        break;
      }
      if (entry) {
        setClockDraft(applyEntryKey(entry.domain, draft, resolved.digit));
        consumed = true;
        break;
      }
      // Live quick rep entry: the first digit opens the pinned entry card
      // immediately and seeds it; further digits append there. Never Next.
      if (snapshot.phase === 'live' || snapshot.phase === 'collection') {
        if (/^\d{0,5}$/.test(draft + resolved.digit)) {
          setClockDraft(draft + resolved.digit);
          consumed = handler({ kind: 'values-open' });
        }
      }
      break;
    }
  }

  if (consumed || keypadEnter) {
    // Suppress the native action exactly once for the consumed key. Main
    // Enter on interactive elements broke before this point and keeps native
    // semantics.
    e.preventDefault();
  }
}

function keypadEnterEvent(e: KeyboardEvent): boolean {
  return e.code === 'NumpadEnter' || e.location === 3;
}

let keyboardInstalled = false;

function syncKeyboardListener(): void {
  const anyKeyboard = [...controllers.values()].some((c) => c.keyboard);
  if (anyKeyboard && !keyboardInstalled && typeof window !== 'undefined') {
    window.addEventListener('keydown', handleClockKeyDown);
    keyboardInstalled = true;
  } else if (!anyKeyboard && keyboardInstalled) {
    window.removeEventListener('keydown', handleClockKeyDown);
    keyboardInstalled = false;
  }
}

// React bindings (contract: hooks re-exported from the commands module).
export {
  useClockController,
  useClockSnapshot,
  useClockDraft,
  useClockDraftError,
} from './useClockController';
export type { ClockControllerOptions } from './useClockController';
