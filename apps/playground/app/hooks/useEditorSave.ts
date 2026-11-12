import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseEditorSaveOptions<T = string> {
  onSave: (snapshot: T) => void | Promise<void>;
  getSnapshotKey?: (snapshot: T) => string;
  onError?: (error: unknown) => void;
  /** Idle autosave debounce (ms) after a dirty onChange. 0 disables. Default 350. */
  idleMs?: number;
}

export interface UseEditorSaveResult<T = string> {
  onChange: (snapshot: T) => void;
  onLineChange: (line: number, column: number) => void;
  onBlur: () => void;
  flush: () => Promise<void>;
  error: unknown;
}

const DEFAULT_IDLE_MS = 350;

export function useEditorSave<T = string>({
  onSave,
  getSnapshotKey,
  onError,
  idleMs,
}: UseEditorSaveOptions<T>): UseEditorSaveResult<T> {
  const draft = useRef<{ value: T; key: string } | null>(null);
  const savedKey = useRef<string | null>(null);
  const activeLine = useRef<number | null>(null);
  const runningRef = useRef<Promise<void> | null>(null);
  const queuedRef = useRef<Promise<void> | null>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ onSave, getSnapshotKey, onError, idleMs });
  callbacks.current = { onSave, getSnapshotKey, onError, idleMs };
  const [error, setError] = useState<unknown>(null);

  const clearIdle = useCallback(() => {
    if (idleRef.current !== null) {
      clearTimeout(idleRef.current);
      idleRef.current = null;
    }
  }, []);

  const runImmediate = useCallback((snapshot: { value: T; key: string }): Promise<void> => {
    if (snapshot.key === savedKey.current) return Promise.resolve();
    let execution!: Promise<void>;
    execution = (async () => {
      try {
        // Enter onSave synchronously (no microtask hop): useNoteDraft registers
        // pendingNoteSaves inside onSave, and an SPA-unmount flush() must have
        // that registration on the same tick it returns.
        await callbacks.current.onSave(snapshot.value);
        savedKey.current = snapshot.key;
        setError(null);
      } catch (failure: unknown) {
        setError(failure);
        callbacks.current.onError?.(failure);
        throw failure;
      } finally {
        if (runningRef.current === execution) {
          runningRef.current = null;
        }
      }
    })();
    runningRef.current = execution;
    return execution;
  }, []);

  const flush = useCallback((): Promise<void> => {
    clearIdle();
    if (!draft.current) {
      return queuedRef.current ?? runningRef.current ?? Promise.resolve();
    }
    if (runningRef.current === null) {
      return runImmediate(draft.current);
    }
    if (queuedRef.current !== null) {
      return queuedRef.current;
    }
    const inFlight = runningRef.current;
    const drain = inFlight
      .catch(() => {})
      .then(() => {
        queuedRef.current = null;
        const latest = draft.current;
        if (!latest || latest.key === savedKey.current) return undefined;
        return runImmediate(latest);
      });
    queuedRef.current = drain;
    return drain;
  }, [runImmediate, clearIdle]);

  const onChange = useCallback((value: T) => {
    const key =
      callbacks.current.getSnapshotKey?.(value) ??
      (typeof value === 'string' ? value : JSON.stringify(value));
    draft.current = { value, key };
    clearIdle();
    const ms = callbacks.current.idleMs ?? DEFAULT_IDLE_MS;
    if (ms > 0 && key !== savedKey.current) {
      idleRef.current = setTimeout(() => {
        idleRef.current = null;
        void flush().catch(() => {});
      }, ms);
    }
  }, [clearIdle, flush]);

  const onLineChange = useCallback(
    (line: number, _column: number) => {
      if (activeLine.current !== null && activeLine.current !== line) {
        void flush().catch(() => {});
      }
      activeLine.current = line;
    },
    [flush],
  );
  const onBlur = useCallback(() => {
    void flush().catch(() => {});
  }, [flush]);

  useEffect(() => {
    const pagehide = () => {
      void flush().catch(() => {});
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') pagehide();
    };
    window.addEventListener('pagehide', pagehide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', pagehide);
      document.removeEventListener('visibilitychange', visibility);
      clearIdle();
      void flush().catch(() => {});
    };
  }, [flush, clearIdle]);

  return { onChange, onLineChange, onBlur, flush, error };
}
