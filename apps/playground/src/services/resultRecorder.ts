import { notePersistence, type INotePersistence } from '@/services/persistence';
import type { ResultOrigin, Session } from '@/types/storage';
import type { Sessions, ScriptBlock } from '@/components/Editor/types';
import { appError } from '@/lib/log';

export type ResultWriter = Pick<INotePersistence, 'finishSession'>;

export interface RecordResultInput {
  runBlock?: ScriptBlock | Pick<ScriptBlock, 'id' | 'contentId'> | null;
  blockId: string;
  noteId: string;
  resultId: string;
  data: Sessions;
  createdAt: number;
  origin?: ResultOrigin;
}

export interface ResultRecorder {
  record(input: RecordResultInput): Promise<Session>;
}

type ResultSavedListener = (result: Session) => void;
const resultSavedListeners = new Set<ResultSavedListener>();

export function onResultSaved(listener: ResultSavedListener): () => void {
  resultSavedListeners.add(listener);
  return () => { resultSavedListeners.delete(listener); };
}

export function notifyResultSaved(result: Session): void {
  for (const listener of resultSavedListeners) {
    try {
      listener(result);
    } catch (err) {
      appError('resultRecorder', 'error in listener:', err);
    }
  }
}

export function createResultRecorder(writer: ResultWriter): ResultRecorder {
  return {
    async record({ resultId, data, createdAt }) {
      const result = await writer.finishSession(resultId, data, createdAt);
      notifyResultSaved(result);
      return result;
    },
  };
}

export const playgroundRecorder = createResultRecorder(notePersistence);
