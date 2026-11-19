/**
 * RuntimeDebugPanel - Slide-out debug panel for runtime inspection
 * 
 * Key Features:
 * - Slide-out panel from the right side
 * - Shows RuntimeStack with inline memory for each block
 * - Only visible when debug mode is enabled
 * - Accessible via debug button next to track button
 * - Can be toggled on/off independently of view mode
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Button, Badge } from "@bitcobblers/wod-wiki-ui/primitives";
import { X, Bug } from 'lucide-react';
import { RuntimeAdapter, RuntimeLogger } from '@/hooks/useRuntimeDebug';
import type { IScriptRuntime } from '@/hooks/useRuntimeTimer';
import type { MemoryEntry } from '@/hooks/useRuntimeDebug';
import { WorkoutContextPanel } from './WorkoutContextPanel';
import { ScriptBlock } from '@/components/Editor/types';
import { MemoryValueDialog, useMemoryValueDialog } from '@/components/molecules/MemoryValuePopover';

type DebugTab = 'parser' | 'stack';

const DEBUG_TABS: { id: DebugTab; label: string }[] = [
  { id: 'parser', label: 'Parser' },
  { id: 'stack', label: 'Stack' },
];

export interface RuntimeDebugPanelProps {
  /** Active runtime to inspect */
  runtime: IScriptRuntime | null;

  /** Whether debug panel is visible */
  isOpen: boolean;

  /** Callback to close the panel */
  onClose: () => void;

  /** Highlighted block key (optional) */
  highlightedBlockKey?: string;

  /** Whether to render embedded (no slide-out, no backdrop) */
  embedded?: boolean;

  /** Additional CSS classes */
  className?: string;

  /** Active workout block for context panel */
  activeBlock?: ScriptBlock | null;

  /** Active statement IDs for highlighting in context panel */
  activeStatementIds?: Set<number>;
}

/**
 * RuntimeDebugPanel Component
 */
export const RuntimeDebugPanel: React.FC<RuntimeDebugPanelProps> = ({
  runtime,
  isOpen,
  onClose,
  highlightedBlockKey,
  embedded = false,
  className = '',
  activeBlock,
  activeStatementIds = new Set()
}) => {
  const adapter = React.useRef(new RuntimeAdapter()).current;

  // Version counter to force snapshot recalculation on memory changes
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<DebugTab>('parser');

  // Dialog for showing memory value details
  const { dialogData, isOpen: isDialogOpen, openDialog, closeDialog } = useMemoryValueDialog();

  // Simple tab change handler
  const handleTabChange = (tab: DebugTab) => {
    setActiveTab(tab);
  };

  // Convert MemoryEntry to MemoryValueData for dialog
  const openMemoryDialog = (entry: MemoryEntry) => {
    openDialog({
      value: entry.value,
      displayValue: entry.valueFormatted,
      label: entry.label,
      type: entry.type,
      isValid: entry.isValid,
      ownerId: entry.ownerId,
      ownerLabel: entry.ownerLabel,
    });
  };

  // Subscribe to runtime changes for live updates
  useEffect(() => {
    if (!runtime) return;

    // Force an immediate snapshot update when runtime becomes available
    setSnapshotVersion(v => v + 1);

    // Subscribe to stack changes (push/pop events)
    const unsubscribeStack = runtime.stack.subscribe((event) => {
      // Increment version to trigger snapshot recalculation
      console.debug('[RuntimeDebugPanel] Stack event:', event?.type || 'initial');
      setSnapshotVersion(v => v + 1);
    });

    // Subscribe to output statements for comprehensive updates
    const unsubscribeOutput = runtime.subscribeToOutput(() => {
      setSnapshotVersion(v => v + 1);
    });

    // Subscribe to tick events for memory updates during execution
    const unsubscribeTick = runtime.eventBus.register(
      'tick',
      {
        id: 'debug-panel-tick-listener',
        name: 'DebugPanelTickListener',
        handler: () => {
          setSnapshotVersion(v => v + 1);
          return [];
        }
      },
      'debug-panel'
    );

    return () => {
      unsubscribeStack();
      unsubscribeOutput();
      if (unsubscribeTick) unsubscribeTick();
    };
  }, [runtime]);

  // Create snapshot for UI rendering - recalculates when snapshotVersion changes
  // snapshotVersion is an intentional refresh trigger: stack events bump it
  // to force a re-snapshot, so it intentionally sits in the deps unsed by body.
  const snapshot = React.useMemo(() => {
    if (!runtime) return null;
    return adapter.createSnapshot(runtime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, adapter, snapshotVersion]);

  // Group memory entries by owner (block key) - must be at top level to avoid hooks order issues
  const memoryByOwner = useMemo(() => {
    if (!snapshot) return new Map<string, MemoryEntry[]>();
    const grouped = new Map<string, MemoryEntry[]>();
    snapshot.memory.entries.forEach(entry => {
      const list = grouped.get(entry.ownerId) || [];
      list.push(entry);
      grouped.set(entry.ownerId, list);
    });
    return grouped;
  }, [snapshot]);

  const renderEmptyState = (title: string, subtitle?: string) => (
    <div className="p-6 text-center text-muted-foreground">
      <p className="text-sm">{title}</p>
      {subtitle && <p className="text-xs mt-2">{subtitle}</p>}
    </div>
  );

  const renderTabContent = () => {
    if (activeTab === 'parser') {
      return (
        <div className="p-3">
          <WorkoutContextPanel
            block={activeBlock || null}
            mode="run"
            activeStatementIds={activeStatementIds}
            className="rounded-lg border border-border"
          />
        </div>
      );
    }

    if (!runtime || !snapshot) {
      const target = activeTab === 'stack' ? 'runtime stack' : 'memory state';
      return renderEmptyState('No active runtime', `Start a session to inspect the ${target}.`);
    }

    // Stack tab (the only remaining tab besides parser)
    // Reverse blocks to show top of stack first (most recent at top)
    const stackBlocks = [...snapshot.stack.blocks].reverse();

    return (
      <div className="flex flex-col h-full">
        {/* Stack Summary Header */}
        <div className="p-2 bg-muted/20 border-b border-border text-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-foreground">
              Call Stack ({snapshot.stack.blocks.length} blocks)
            </span>
            <span className="text-muted-foreground">
              Memory: {snapshot.memory.entries.length} entries
            </span>
          </div>
        </div>

        {/* Stack List with inline memory */}
        <div className="flex-1 overflow-auto">
          {stackBlocks.length === 0 ? (
            <div className="text-center text-muted-foreground py-4 text-xs">
              Stack is empty
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {stackBlocks.map((block, index) => {
                const isTop = index === 0;
                const isHighlighted = highlightedBlockKey === block.key;
                const statusColor = {
                  complete: 'bg-success',
                  active: 'bg-metric-time',
                  running: 'bg-metric-time animate-pulse',
                  pending: 'bg-muted-foreground/40',
                  error: 'bg-destructive'
                }[block.status || 'pending'];

                // Get memory entries for this block
                const blockMemory = memoryByOwner.get(block.key) || [];
                const hasMemory = blockMemory.length > 0;

                return (
                  <div key={block.key}>
                    {/* Block Row */}
                    <div
                      className={`
                        flex items-center gap-2 py-2 px-3 text-xs select-none
                        ${isTop ? 'bg-primary/5' : ''}
                        ${isHighlighted ? 'bg-primary/10' : ''}
                      `}
                      title={block.key}
                    >
                      {/* Stack Position */}
                      <div className="w-5 text-center shrink-0">
                        <span className={`font-mono ${isTop ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
                          {isTop ? '→' : index}
                        </span>
                      </div>

                      {/* Status Indicator */}
                      <div className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} />

                      {/* Icon */}
                      {block.icon && (
                        <span className="shrink-0">{block.icon}</span>
                      )}

                      {/* Block Label */}
                      <div className="flex-1 min-w-0">
                        <span className={`font-medium truncate ${isTop ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {block.label}
                        </span>
                      </div>

                      {/* Block Type Badge */}
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                      >
                        {block.blockType}
                      </Badge>

                      {/* Key (truncated) */}
                      <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[60px] shrink-0" title={block.key}>
                        {block.key.split('-').pop()}
                      </span>
                    </div>

                    {/* Inline Memory Entries (always shown) */}
                    {hasMemory && (
                      <div className="bg-muted/20 border-t border-border/30">
                        <table className="w-full text-[10px]">
                          <tbody>
                            {blockMemory.map(entry => (
                              <tr
                                key={entry.id}
                                className="border-b border-border/20 last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                                onClick={() => openMemoryDialog(entry)}
                                title="Click to view full value"
                              >
                                <td className="py-1 pl-8 pr-2 text-muted-foreground font-mono w-16">
                                  {entry.type}
                                </td>
                                <td className="py-1 px-2 text-foreground truncate max-w-[120px]" title={entry.label}>
                                  {entry.label}
                                </td>
                                <td className="py-1 pl-2 pr-3 text-right font-mono text-primary truncate max-w-[100px]" title={entry.valueFormatted}>
                                  {entry.valueFormatted}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const tabBar = (
    <div className="flex border-b border-border bg-muted/20 text-[11px] font-semibold uppercase tracking-wider">
      {DEBUG_TABS.map(tab => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            className={`flex-1 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${isActive
              ? 'text-foreground bg-background border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
              }`}
            onClick={() => handleTabChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  // Embedded mode - render inline without slide-out behavior
  if (embedded) {
    return (
      <>
        <div className={`h-full flex flex-col bg-background ${className}`}>
          {/* Header */}
          <div className="p-3 border-b border-border flex items-center gap-2 bg-muted/30 shrink-0">
            <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            <h3 className="font-semibold text-sm">Runtime Debugger</h3>
          </div>

          {tabBar}

          {/* Content */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {renderTabContent()}
          </div>

          {/* Footer */}
          <div className="p-2 border-t border-border bg-muted/10 text-xs text-muted-foreground shrink-0">
            <div className="flex items-center justify-between">
              <span>Stack: {snapshot?.stack.blocks.length || 0} blocks</span>
              <span>Memory: {snapshot?.memory.entries.length || 0} entries</span>
            </div>
          </div>
        </div>

        {/* Memory Value Dialog */}
        <MemoryValueDialog
          data={dialogData}
          isOpen={isDialogOpen}
          onClose={closeDialog}
        />
      </>
    );
  }

  // Slide-out mode (original behavior)

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 dark:bg-black/20 z-40 animate-in fade-in duration-200"
          onClick={onClose}
        />
      )}

      {/* Slide-out Panel */}
      <div
        className={`
          fixed right-0 top-0 bottom-0 w-full sm:w-[480px] max-w-full bg-background border-l border-border z-50
          shadow-2xl flex flex-col
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
          ${className}
        `}
      >
        {/* Header */}
        <div className="p-3 border-b border-border flex items-center justify-between bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            <h3 className="font-semibold text-sm">Runtime Debugger</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close debugger" title="Close debugger" className="h-11 w-11">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {tabBar}

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {renderTabContent()}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-border bg-muted/10 text-xs text-muted-foreground shrink-0">
          <div className="flex items-center justify-between">
            <span>Stack: {snapshot?.stack.blocks.length || 0} blocks</span>
            <span>Memory: {snapshot?.memory.entries.length || 0} entries</span>
          </div>
        </div>
      </div>

      {/* Memory Value Dialog */}
      <MemoryValueDialog
        data={dialogData}
        isOpen={isDialogOpen}
        onClose={closeDialog}
      />
    </>
  );
};

/**
 * Debug Button Component
 * Standalone button to toggle debug panel
 */
export interface DebugButtonProps {
  isDebugMode: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export const DebugButton: React.FC<DebugButtonProps> = ({
  isDebugMode,
  onClick,
  disabled = false
}) => {
  // Sync RuntimeLogger with debug mode state
  React.useEffect(() => {
    if (isDebugMode) {
      RuntimeLogger.enable();
    } else {
      RuntimeLogger.disable();
    }
  }, [isDebugMode]);

  return (
    <Button
      variant={isDebugMode ? "default" : "ghost"}
      size="icon"
      onClick={onClick}
      disabled={disabled}
      className="h-11 w-11 relative"
      title={isDebugMode ? "Close debugger (console logging enabled)" : "Open debugger"}
    >
      <Bug className="h-[1.2rem] w-[1.2rem]" />
      {isDebugMode && (
        <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-success animate-pulse" />
      )}
      <span className="sr-only">Toggle debugger</span>
    </Button>
  );
};
