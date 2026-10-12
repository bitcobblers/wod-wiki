import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseEditorSaveOptions<T = string> {
  onSave: (snapshot: T) => void | Promise<void>;
  lineIdleMs?: number;
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

export function useEditorSave<T = string>({ onSave, lineIdleMs = 800, getSnapshotKey, onError }: UseEditorSaveOptions<T>): UseEditorSaveResult<T> {
  const draft = useRef<{ value: T; key: string } | null>(null);
  const savedKey = useRef<string | null>(null);
  const activeLine = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void>>(Promise.resolve());
  const callbacks = useRef({ onSave, getSnapshotKey, onError });
  callbacks.current = { onSave, getSnapshotKey, onError };
  const [error, setError] = useState<unknown>(null);

  const cancelTimer = useCallback(() => {
    clearTimeout(timer.current ?? undefined);
    timer.current = null;
  }, []);

  const save = useCallback((snapshot: { value: T; key: string }): Promise<void> => {
    const result = inflight.current.then(async () => {
      if (snapshot.key === savedKey.current) return;
      await callbacks.current.onSave(snapshot.value);
      savedKey.current = snapshot.key;
      setError(null);
    });
    inflight.current = result.catch(failure => {
      setError(failure);
      callbacks.current.onError?.(failure);
    });
    return result;
  }, []);

  const flush = useCallback((): Promise<void> => {
    cancelTimer();
    return draft.current ? save(draft.current) : inflight.current;
  }, [cancelTimer, save]);

  const onChange = useCallback((value: T) => {
    const key = callbacks.current.getSnapshotKey?.(value) ?? (typeof value === 'string' ? value : JSON.stringify(value));
    draft.current = { value, key };
    cancelTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      if (draft.current) void save(draft.current).catch(() => {});
    }, lineIdleMs);
  }, [cancelTimer, lineIdleMs, save]);

  const onLineChange = useCallback((line: number, _column: number) => {
    if (activeLine.current !== null && activeLine.current !== line) void flush().catch(() => {});
    activeLine.current = line;
  }, [flush]);
  const onBlur = useCallback(() => { void flush().catch(() => {}); }, [flush]);

  useEffect(() => {
    const pagehide = () => { void flush().catch(() => {}); };
    const visibility = () => { if (document.visibilityState === 'hidden') pagehide(); };
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
