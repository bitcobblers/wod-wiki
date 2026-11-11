import React from 'react';
import type { SnapshotDiff } from '../contracts/SnapshotTypes';

interface SnapshotDiffViewerProps {
  diff: SnapshotDiff;
  className?: string;
}

/**
 * Visual diff viewer for before/after runtime snapshots.
 * Shows stack and memory changes with color-coded additions/removals.
 */
export const SnapshotDiffViewer: React.FC<SnapshotDiffViewerProps> = ({
  diff,
  className = ''
}) => {
  return (
    <div className={`snapshot-diff-viewer grid grid-cols-2 gap-4 ${className}`}>
      {/* Before Snapshot */}
      <div className="before-snapshot">
        <h4 className="font-medium mb-2 text-gray-600">
          BEFORE
          {diff.before.label && (
            <span className="text-xs ml-2 text-gray-400">({diff.before.label})</span>
          )}
        </h4>
        
        {/* Stack */}
        <div className="stack-view mb-4">
          <h5 className="text-sm font-medium mb-1">Stack ({diff.before.stack.depth})</h5>
          <div className="space-y-1">
            {diff.before.stack.blockKeys.length === 0 ? (
              <div className="p-2 rounded text-sm text-gray-400 bg-gray-50 italic">
                Empty stack
              </div>
            ) : (
              diff.before.stack.blockKeys.map((key, i) => (
                <div
                  key={key}
                  className={`p-2 rounded text-sm font-mono ${
                    diff.stack.popped.includes(key)
                      ? 'bg-red-100 line-through text-red-700'
                      : 'bg-gray-100'
                  }`}
                >
                  {i === diff.before.stack.blockKeys.length - 1 ? '→ ' : '  '}
                  {key}
                </div>
              ))
            )}
          </div>
        </div>
        
        {/* Memory */}
        <div className="memory-view">
          <h5 className="text-sm font-medium mb-1">
            Memory ({diff.before.memory.totalCount})
          </h5>
          <div className="space-y-1">
            {diff.before.memory.entries.length === 0 ? (
              <div className="p-2 rounded text-sm text-gray-400 bg-gray-50 italic">
                No memory entries
              </div>
            ) : (
              diff.before.memory.entries.map(entry => (
                <div
                  key={entry.id}
                  className={`p-2 rounded text-xs font-mono ${
                    diff.memory.released.includes(entry.id)
                      ? 'bg-red-100 line-through'
                      : diff.memory.modified.some(m => m.id === entry.id)
                      ? 'bg-yellow-100'
                      : 'bg-gray-100'
                  }`}
                >
                  <div className="flex justify-between">
                    <span className="text-blue-600">{entry.type}</span>
                    <span className={`${entry.visibility === 'public' ? 'text-green-600' : 'text-gray-500'}`}>
                      {entry.visibility}
                    </span>
                  </div>
                  <div className="text-gray-500 text-xs truncate">
                    owner: {entry.ownerId}
                  </div>
                  <div className="truncate mt-1">{formatValue(entry.value)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {/* After Snapshot */}
      <div className="after-snapshot">
        <h4 className="font-medium mb-2 text-gray-600">
          AFTER
          {diff.after.label && (
            <span className="text-xs ml-2 text-gray-400">({diff.after.label})</span>
          )}
        </h4>
        
        {/* Stack */}
        <div className="stack-view mb-4">
          <h5 className="text-sm font-medium mb-1">Stack ({diff.after.stack.depth})</h5>
          <div className="space-y-1">
            {diff.after.stack.blockKeys.length === 0 ? (
              <div className="p-2 rounded text-sm text-gray-400 bg-gray-50 italic">
                Empty stack
              </div>
            ) : (
              diff.after.stack.blockKeys.map((key, i) => (
                <div
                  key={key}
                  className={`p-2 rounded text-sm font-mono ${
                    diff.stack.pushed.includes(key)
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100'
                  }`}
                >
                  {i === diff.after.stack.blockKeys.length - 1 ? '→ ' : '  '}
                  {key}
                </div>
              ))
            )}
          </div>
        </div>
        
        {/* Memory */}
        <div className="memory-view">
          <h5 className="text-sm font-medium mb-1">
            Memory ({diff.after.memory.totalCount})
          </h5>
          <div className="space-y-1">
            {diff.after.memory.entries.length === 0 ? (
              <div className="p-2 rounded text-sm text-gray-400 bg-gray-50 italic">
                No memory entries
              </div>
            ) : (
              diff.after.memory.entries.map(entry => (
                <div
                  key={entry.id}
                  className={`p-2 rounded text-xs font-mono ${
                    diff.memory.allocated.includes(entry.id)
                      ? 'bg-green-100'
                      : diff.memory.modified.some(m => m.id === entry.id)
                      ? 'bg-yellow-100'
                      : 'bg-gray-100'
                  }`}
                >
                  <div className="flex justify-between">
                    <span className="text-blue-600">{entry.type}</span>
                    <span className={`${entry.visibility === 'public' ? 'text-green-600' : 'text-gray-500'}`}>
                      {entry.visibility}
                    </span>
                  </div>
                  <div className="text-gray-500 text-xs truncate">
                    owner: {entry.ownerId}
                  </div>
                  <div className="truncate mt-1">{formatValue(entry.value)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Summary of changes between snapshots
 */
export const SnapshotDiffSummary: React.FC<{ diff: SnapshotDiff; className?: string }> = ({
  diff,
  className = ''
}) => {
  const hasChanges = 
    diff.stack.pushed.length > 0 ||
    diff.stack.popped.length > 0 ||
    diff.memory.allocated.length > 0 ||
    diff.memory.released.length > 0 ||
    diff.memory.modified.length > 0;

  return (
    <div className={`snapshot-diff-summary ${className}`}>
      {!hasChanges ? (
        <div className="text-gray-500 italic">No changes detected</div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {/* Stack Changes */}
          <div className="stack-changes">
            <h4 className="font-medium mb-2 text-sm">Stack Changes</h4>
            <div className="space-y-1 text-sm">
              {diff.stack.pushed.length > 0 && (
                <div className="text-green-600">
                  + {diff.stack.pushed.length} pushed: {diff.stack.pushed.join(', ')}
                </div>
              )}
              {diff.stack.popped.length > 0 && (
                <div className="text-red-600">
                  - {diff.stack.popped.length} popped: {diff.stack.popped.join(', ')}
                </div>
              )}
              <div className="text-gray-500">
                Depth: {diff.before.stack.depth} → {diff.after.stack.depth} 
                ({diff.stack.depthChange >= 0 ? '+' : ''}{diff.stack.depthChange})
              </div>
            </div>
          </div>

          {/* Memory Changes */}
          <div className="memory-changes">
            <h4 className="font-medium mb-2 text-sm">Memory Changes</h4>
            <div className="space-y-1 text-sm">
              {diff.memory.allocated.length > 0 && (
                <div className="text-green-600">
                  + {diff.memory.allocated.length} allocated
                </div>
              )}
              {diff.memory.released.length > 0 && (
                <div className="text-red-600">
                  - {diff.memory.released.length} released
                </div>
              )}
              {diff.memory.modified.length > 0 && (
                <div className="text-yellow-600">
                  ~ {diff.memory.modified.length} modified
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Detailed view of modified memory values
 */
export const ModifiedValuesViewer: React.FC<{
  modified: SnapshotDiff['memory']['modified'];
  className?: string;
}> = ({ modified, className = '' }) => {
  if (modified.length === 0) {
    return null;
  }

  return (
    <div className={`modified-values ${className}`}>
      <h4 className="font-medium mb-2 text-sm">Modified Values</h4>
      <div className="space-y-2">
        {modified.map((mod, i) => (
          <div key={i} className="bg-yellow-50 p-2 rounded text-xs font-mono">
            <div className="text-gray-600 mb-1 truncate">{mod.id}</div>
            <div className="flex items-center gap-2">
              <span className="text-red-600 line-through">{formatValue(mod.oldValue)}</span>
              <span className="text-gray-400">→</span>
              <span className="text-green-600">{formatValue(mod.newValue)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Helper function to format values for display
function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') {
    try {
      const str = JSON.stringify(value);
      return str.length > 50 ? str.substring(0, 47) + '...' : str;
    } catch {
      return '{...}';
    }
  }
  return String(value);
}

export default SnapshotDiffViewer;
