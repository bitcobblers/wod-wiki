import React, { useMemo } from 'react';
import type { ScriptBlock } from '@/components/Editor/types';
import { NoteEditor, type EditorIdentitySnapshot } from '@/components/organisms/editor/NoteEditor';
import type { NoteBlock } from '@/types/storage';
import { useTheme } from '@/contexts/ThemeProvider';
import { BlockHistory } from '@/components/organisms/editor/BlockHistory';
import type { BlockRevision } from '@/types/storage';
import type { INotePersistence } from '@/services/persistence';

export interface PlanPanelProps {
  initialContent?: string;
  value?: string;
  noteBlocks?: Record<string, NoteBlock>;
  notePersistence?: INotePersistence;
  sourceRevision?: number;
  onIdentityChange?: (snapshot: EditorIdentitySnapshot) => void;
  onSaved?: (snapshot: EditorIdentitySnapshot) => void;
  beforeRun?: () => Promise<number | void>;
  onRevert?: (revision: BlockRevision) => Promise<void>;
  /** @deprecated Ignored — sections are parsed internally by NoteEditor */
  sections?: unknown[] | null;
  onStartWorkout: (block: ScriptBlock) => void;
  onCompleteWorkout?: (blockId: string, results: ScriptBlock["results"], resultId?: string, runBlock?: Pick<ScriptBlock, "id" | "contentId">) => void;
  /** @deprecated Ignored — active block tracking is handled by the overlay */
  setActiveBlockId?: (blockId: string | null) => void;
  setBlocks: (blocks: ScriptBlock[]) => void;
  setContent: (content: string) => void;
  readOnly?: boolean;
  /** @deprecated Ignored — content provider not needed by NoteEditor */
  provider?: unknown;
  /** @deprecated Ignored */
  sourceNoteId?: string;
}

export const PlanPanel: React.FC<PlanPanelProps> = ({
  initialContent,
  value,
  noteBlocks,
  notePersistence,
  sourceRevision,
  onIdentityChange,
  onSaved,
  beforeRun,
  onRevert,
  onStartWorkout,
  onCompleteWorkout,
  setBlocks,
  setContent,
  readOnly = false,
  sourceNoteId,
}) => {
  const { theme } = useTheme();

  const resolvedTheme = useMemo(() => {
    if (theme === 'dark') return 'vs-dark';
    if (theme === 'light') return 'vs';
    // "system" — detect from prefers-color-scheme
    if (typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'vs-dark';
    }
    return 'vs';
  }, [theme]);

  return (
    <div className="h-full w-full relative flex flex-col group/plan-panel">
      <div className="flex-1 min-h-0 relative">
        <NoteEditor
          noteId={sourceNoteId}
          notePersistence={notePersistence}
          noteBlocks={noteBlocks}
          sourceRevision={sourceRevision}
          onIdentityChange={onIdentityChange}
          onSaved={onSaved}
          beforeRun={beforeRun}
          value={value ?? initialContent ?? ''}
          onChange={setContent}
          onBlocksChange={setBlocks}
          onStartWorkout={onStartWorkout}
          onCompleteWorkout={onCompleteWorkout}
          readonly={readOnly}
          showLineNumbers={true}
          theme={resolvedTheme}
          enableOverlay={false}
          enablePreview={true}
          enableLinting={true}
          className="h-full"
        />
      </div>
      {sourceNoteId && <BlockHistory noteId={sourceNoteId} blocks={noteBlocks} sourceRevision={sourceRevision} persistence={notePersistence} onRevert={readOnly ? undefined : onRevert} />}
    </div>
  );
};
