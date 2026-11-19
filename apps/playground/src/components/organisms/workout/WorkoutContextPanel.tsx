/**
 * WorkoutContextPanel - Unified component for displaying workout context
 * 
 * Supports three modes:
 * 1. Edit Mode - Shows statements with edit/delete buttons
 * 2. Run Mode - Shows active statements in read-only with real-time execution tracking
 * 3. Review Mode - Shows completed statements with historical metrics from repository
 * 
 * Consolidated from separate WorkoutContextPanel and ContextPanel components.
 * Features optional display of parse errors, block metadata, and timer dialogs.
 */

import React from 'react';
import { ScriptBlock } from '@/components/Editor/types';
import { StatementList } from './StatementList';
import { Button } from "@bitcobblers/wod-wiki-ui/primitives";
import { Play } from 'lucide-react';

export type WorkoutContextMode = 'edit' | 'run' | 'review';

export interface WorkoutContextPanelProps {
  /** The workout block to display */
  block: ScriptBlock | null;

  /** Display mode */
  mode: WorkoutContextMode;

  /** Whether to show the start button (edit mode only) */
  showStartButton?: boolean;

  /** Callback when start button is clicked */
  onStart?: () => void;

  /** Callback when editing a statement (edit mode only) */
  onEditStatement?: (index: number, text: string) => void;

  /** Callback when deleting a statement (edit mode only) */
  onDeleteStatement?: (index: number) => void;

  /** Callback when adding a statement (edit mode with new statements) */
  onAddStatement?: (text: string) => void;

  /** Active statement IDs (blocks currently on the stack) */
  activeStatementIds?: Set<number>;

  /** Whether to show parse errors (default: false) */
  showErrors?: boolean;

  /** Whether to show block metadata (default: false) */
  showMetadata?: boolean;

  /** Whether to show the timer dialog (default: false) */
  showTimerDialog?: boolean;

  /** Whether panel is in mobile/compact mode (default: false) */
  mobile?: boolean;

  /** Whether panel is compact (default: false) */
  compact?: boolean;

  /** Additional CSS classes */
  className?: string;
}

/**
 * Main workout context panel component
 */
export const WorkoutContextPanel: React.FC<WorkoutContextPanelProps> = ({
  block,
  mode,
  showStartButton = false,
  onStart,

  activeStatementIds = new Set(),
  showErrors = false,
  showMetadata = false,
  mobile = false,
  compact = false,
  className = ''
}) => {

  if (!block) {
    return (
      <div className={`flex flex-col items-center justify-center h-full text-muted-foreground ${className}`}>
        <p className="text-sm">No session selected</p>
      </div>
    );
  }

  const readonly = mode !== 'edit';
  const hasStatements = block.statements && block.statements.length > 0;
  const hasErrors = showErrors && block.errors && block.errors.length > 0;

  return (
    <div className={`${mobile ? 'bg-background' : 'bg-muted/10'} flex flex-col min-h-[200px] ${className}`}>
      {/* Header - shown only on mobile or when metadata is requested */}
      {mobile && (
        <div className={`border-b border-border bg-muted/50 p-6`}>
          <h3 className="text-lg font-semibold text-foreground">
            WOD Block Context
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Lines {block.startLine + 1} - {block.endLine + 1}
          </p>
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 overflow-y-auto ${mobile ? 'p-6' : 'p-4'}`}>
        {/* Parsing Status */}
        {block.state === 'parsing' && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
            <p className="text-sm text-blue-700 dark:text-blue-300">Parsing session...</p>
          </div>
        )}

        {/* Parse Errors */}
        {hasErrors && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded">
            <h4 className="text-sm font-semibold text-destructive mb-2">
              Parse Errors
            </h4>
            {block.errors!.map((error, idx) => (
              <div key={idx} className="text-xs text-destructive mb-1">
                {error.line && <span className="font-mono">Line {error.line}: </span>}
                {error.message}
              </div>
            ))}
          </div>
        )}

        {/* Statement List */}
        <div className="font-mono text-sm relative">
          {hasStatements ? (
            <StatementList
              statements={block.statements || []}
              activeStatementIds={activeStatementIds}
              readonly={readonly}
            />
          ) : (
            <div className="text-muted-foreground italic">
              {mode === 'edit' && '// No parsed statements available'}
              {mode === 'run' && '// Waiting for session to start'}
              {mode === 'review' && '// No data available'}
              {mobile && block.state !== 'parsing' && '// No session content yet'}
            </div>
          )}
        </div>

        {/* Block Metadata (optional) */}
        {showMetadata && !compact && !mobile && (
          <div className="mt-6 pt-4 border-t border-muted-foreground/20">
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">
              Block Information
            </h4>
            <dl className="text-xs space-y-1">
              <div className="flex justify-between">
                <dt className="text-muted-foreground/70">State:</dt>
                <dd className="font-mono text-muted-foreground">{block.state}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground/70">Statements:</dt>
                <dd className="text-muted-foreground">{block.statements?.length || 0}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground/70">Content Length:</dt>
                <dd className="text-muted-foreground">{block.content.length} chars</dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="py-2">
        {mode === 'edit' && showStartButton && hasStatements && onStart && (
          <div className={mobile ? 'p-4' : 'px-4 py-2 border-t border-border'}>
            <Button onClick={onStart} className="w-full" size={mobile ? 'lg' : 'sm'}>
              <Play className="mr-2 h-5 w-5" />
              Start Session
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
