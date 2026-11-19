import React, { useMemo, useState, useCallback } from 'react';
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@bitcobblers/wod-wiki-ui/primitives';
import { X } from 'lucide-react';

export interface MemoryValueData {
  /** The raw value to display in the popover */
  value: unknown;
  /** Formatted display string for the trigger */
  displayValue: string;
  /** Memory entry label */
  label: string;
  /** Memory type */
  type: string;
  /** Whether the memory entry is valid */
  isValid: boolean;
  /** Owner identifier */
  ownerId: string;
  /** Optional owner label */
  ownerLabel?: string;
}

/**
 * JSON syntax highlighter component
 * Provides colorized display of JSON values
 */
const SyntaxHighlightedJson: React.FC<{ json: string }> = ({ json }) => {
  const highlighted = useMemo(() => {
    // Tokenize and colorize JSON
    const lines = json.split('\n');
    
    return lines.map((line, lineIndex) => {
      const tokens: React.ReactNode[] = [];
      let remaining = line;
      let keyIndex = 0;
      let iterations = 0;
      const maxIterations = 10000; // Safety limit
      
      // Match patterns for JSON syntax highlighting
      const patterns = [
        { regex: /^\s+/, className: '' }, // whitespace (must match at least one)
        { regex: /^"([^"\\]|\\.)*"(?=\s*:)/, className: 'text-blue-600 dark:text-blue-400' }, // keys
        { regex: /^"([^"\\]|\\.)*"/, className: 'text-green-600 dark:text-green-400' }, // string values
        { regex: /^(true|false)/, className: 'text-purple-600 dark:text-purple-400' }, // booleans
        { regex: /^null/, className: 'text-gray-500 dark:text-gray-400' }, // null
        { regex: /^-?\d+\.?\d*([eE][+-]?\d+)?/, className: 'text-amber-600 dark:text-amber-400' }, // numbers
        { regex: /^[{}[\],:]/, className: 'text-gray-600 dark:text-gray-400' }, // punctuation
      ];
      
      while (remaining.length > 0 && iterations < maxIterations) {
        iterations++;
        let matched = false;
        
        for (const { regex, className } of patterns) {
          const match = remaining.match(regex);
          if (match && match[0].length > 0) {
            const text = match[0];
            if (className) {
              tokens.push(
                <span key={`${lineIndex}-${keyIndex++}`} className={className}>
                  {text}
                </span>
              );
            } else {
              tokens.push(text);
            }
            remaining = remaining.slice(text.length);
            matched = true;
            break;
          }
        }
        
        if (!matched) {
          // Move one character if no pattern matched
          tokens.push(remaining[0]);
          remaining = remaining.slice(1);
        }
      }
      
      return (
        <div key={lineIndex} className="leading-relaxed">
          {tokens}
        </div>
      );
    });
  }, [json]);
  
  return <>{highlighted}</>;
};

/**
 * Safely stringify a value to JSON, handling circular references
 */
const safeJsonStringify = (value: unknown): string => {
  try {
    const seen = new WeakSet();
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        // Handle special types
        if (val instanceof Date) return val.toISOString();
        if (typeof val === 'function') return '[Function]';
        if (typeof val === 'symbol') return val.toString();
        return val;
      },
      2
    );
  } catch {
    try {
      return String(value);
    } catch {
      return '[unserializable]';
    }
  }
};

/**
 * Get the type badge color based on memory type
 */
const getTypeBadgeColor = (type: string): string => {
  const typeColors: Record<string, string> = {
    'metric': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    'timer-state': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    'loop-state': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    'group-state': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    'handler': 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    'span': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  };
  return typeColors[type] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
};

/**
 * MemoryValueDialog - A modal dialog to display memory value details
 * This is a single shared component rendered once, opened via state
 */
export const MemoryValueDialog: React.FC<{
  data: MemoryValueData | null;
  isOpen: boolean;
  onClose: () => void;
}> = ({ data, isOpen, onClose }) => {
  const jsonString = useMemo(() => data ? safeJsonStringify(data.value) : '', [data]);
  const isComplexValue = data && typeof data.value === 'object' && data.value !== null;

  if (!data) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogBackdrop className="bg-black/25 dark:bg-black/25" />
      <DialogContent className="w-full max-w-md overflow-hidden rounded-lg shadow-xl border border-border bg-popover text-popover-foreground p-0 gap-0">
        <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                data.isValid ? 'bg-signal-positive' : 'bg-signal-negative'
              }`}
            />
            <DialogTitle className="text-sm font-semibold truncate" title={data.label}>
              {data.label}
            </DialogTitle>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${getTypeBadgeColor(data.type)}`}>
              {data.type}
            </span>
          </div>
          <DialogClose
            aria-label="Close"
            className="h-auto w-auto border-0 bg-transparent text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/50 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </DialogClose>
        </div>

        <div className="px-3 py-2 border-b border-border/50 bg-muted/10">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium">Owner:</span>
            <span className="font-mono truncate" title={data.ownerLabel || data.ownerId}>
              {data.ownerLabel || data.ownerId}
            </span>
          </div>
        </div>

        <div className="p-3 max-h-80 overflow-auto">
          {isComplexValue ? (
            <div className="space-y-2">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Object Structure
              </div>
              <pre className="bg-muted/50 p-2 rounded border border-border/50 text-xs font-mono overflow-auto max-h-60">
                <SyntaxHighlightedJson json={jsonString} />
              </pre>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Value
              </div>
              <div className="bg-muted/50 p-2 rounded border border-border/50 font-mono text-sm break-all">
                <span className={
                  typeof data.value === 'string' ? 'text-green-600 dark:text-green-400' :
                  typeof data.value === 'number' ? 'text-amber-600 dark:text-amber-400' :
                  typeof data.value === 'boolean' ? 'text-purple-600 dark:text-purple-400' :
                  data.value === null ? 'text-muted-foreground' : ''
                }>
                  {data.displayValue}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="px-3 py-2 border-t border-border bg-muted/20 flex justify-between items-center text-[10px] text-muted-foreground">
          <span className={data.isValid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
            {data.isValid ? '● Valid' : '● Invalid'}
          </span>
          <span className="font-mono">
            {typeof data.value === 'object' && data.value !== null
              ? `${Array.isArray(data.value) ? 'Array' : 'Object'}[${Object.keys(data.value).length}]`
              : typeof data.value
            }
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Hook to manage memory value dialog state
 * Returns state and handlers for the shared dialog
 */
export function useMemoryValueDialog() {
  const [dialogData, setDialogData] = useState<MemoryValueData | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const openDialog = useCallback((data: MemoryValueData) => {
    setDialogData(data);
    setIsOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    dialogData,
    isOpen,
    openDialog,
    closeDialog,
  };
}

/**
 * MemoryValueCell - A simple clickable cell that opens the dialog
 * This is lightweight and can be rendered many times
 */
export const MemoryValueCell: React.FC<{
  data: MemoryValueData;
  onClick: (data: MemoryValueData) => void;
  className?: string;
}> = ({ data, onClick, className = '' }) => {
  return (
    <button
      type="button"
      onClick={() => onClick(data)}
      className={`
        font-mono text-foreground truncate max-w-[100px] cursor-pointer text-left
        hover:text-primary hover:underline focus:outline-none focus:text-primary
        ${className}
      `}
      title={`Click to view details: ${data.displayValue}`}
    >
      {data.displayValue}
    </button>
  );
};

export default MemoryValueDialog;
