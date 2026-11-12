import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseEditorSaveOptions<T = string> {
  onSave: (snapshot: T) => void | Promise<void>;
  getSnapshotKey?: (snapshot: T) => string;
  onError?: (error: unknown) => void;
}

export interface UseEditorSaveResult<T = string> {
  onChange: (snapshot: T) => void;
  onLineChange: (line: number, column: number) => void;
  onBlur: () => void;
  flush: () => Promise<void>;
  error: unknown;
}

// ponytail: saves are coalesced — no idle timer. Drafts persist on line change,
// blur, pagehide/visibility, explicit flush (Ctrl+S), and unmount. While a save
// is in flight, subsequent flushes coalesce into a single follow-up save of the
// latest draft rather than replaying every intermediate line snapshot.
export function useEditorSave<T = string>({
  onSave,
  getSnapshotKey,
  onError,
}: UseEditorSaveOptions<T>): UseEditorSaveResult<T> {
  const draft = useRef<{ value: T; key: string } | null>(null);
  const savedKey = useRef<string | null>(null);
  const activeLine = useRef<number | null>(null);
  const runningRef = useRef<Promise<void> | null>(null);
  const queuedRef = useRef<Promise<void> | null>(null);
  const callbacks = useRef({ onSave, getSnapshotKey, onError });
  callbacks.current = { onSave, getSnapshotKey, onError };
  const [error, setError] = useState<unknown>(null);

  const runImmediate = useCallback((snapshot: { value: T; key: string }): Promise<void> => {
    if (snapshot.key === savedKey.current) return Promise.resolve();
    const execution = Promise.resolve()
      .then(async () => {
        await callbacks.current.onSave(snapshot.value);
        savedKey.current = snapshot.key;
        setError(null);
      })
      .catch((failure: unknown) => {
        setError(failure);
        callbacks.current.onError?.(failure);
        throw failure;
      })
      .finally(() => {
        if (runningRef.current === execution) {
          runningRef.current = null;
        }
      });
    runningRef.current = execution;
    return execution;
  }, []);

  const flush = useCallback((): Promise<void> => {
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
  }, [runImmediate]);

  const onChange = useCallback((value: T) => {
    const key =
      callbacks.current.getSnapshotKey?.(value) ??
      (typeof value === 'string' ? value : JSON.stringify(value));
    draft.current = { value, key };
  }, []);

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
      void flush().catch(() => {});
    };
  }, [flush]);

  return { onChange, onLineChange, onBlur, flush, error };
}
