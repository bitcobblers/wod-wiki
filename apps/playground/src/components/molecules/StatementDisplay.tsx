/**
 * StatementDisplay - Unified component for displaying workout statements/blocks
 * 
 * This is the standard way to display code statements, runtime blocks, and their
 * associated metrics across all panels (Editor, Timer, Analytics).
 * 
 * Uses MetricVisualizer for consistent color-coded metrics rendering.
 */

import React from 'react';
import { ICodeStatement } from '@bitcobblers/wod-wiki-engine';
import { IMetric } from '@bitcobblers/wod-wiki-engine';
import { MetricVisualizer } from '../../views/runtime/MetricVisualizer';
import { cn } from '../../lib/utils';

export interface StatementDisplayProps {
  /** Statement to display (includes metrics) */
  statement: ICodeStatement;

  /** Whether this statement is currently active */
  isActive?: boolean;

  /** Whether this is part of a group (removes outer border) */
  isGrouped?: boolean;

  /** Compact mode for smaller displays */
  compact?: boolean;

  /** Additional actions to render on the right */
  actions?: React.ReactNode;

  /** Additional CSS classes */
  className?: string;

  /** Click handler */
  onClick?: () => void;
}

/**
 * StatementDisplay - Single statement with colored metrics
 */
export const StatementDisplay: React.FC<StatementDisplayProps> = ({
  statement,
  isActive = false,
  isGrouped = false,
  compact = false,
  actions,
  className,
  onClick
}) => {
  const containerClass = cn(
    'flex items-center gap-2 transition-colors',
    compact ? 'p-1.5' : 'p-2',
    isGrouped
      ? cn('hover:bg-accent/5', isActive && 'bg-primary/10')
      : cn(
        'bg-card rounded border border-border hover:border-primary/50',
        isActive && 'bg-primary/10 border-primary'
      ),
    onClick && 'cursor-pointer',
    className
  );

  const handleKeyDown = onClick
    ? (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }
    : undefined;

  return (
    <div
      className={containerClass}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="flex-1 min-w-0">
        <MetricVisualizer
          metrics={statement.metrics.toArray()}
          className={compact ? 'gap-0.5' : 'gap-1'}
        />
      </div>
      {actions && (
        <div className="flex gap-1 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
};

/**
 * Props for BlockDisplay - displays a runtime block with its metrics
 */
export interface BlockDisplayProps {
  /** Block label/name */
  label: string;

  /** Block type (e.g., 'timer', 'rounds', 'effort') */
  blockType: string;

  /** Pre-defined metrics from the block */
  metrics?: IMetric[];

  /** Status of the block */
  status?: 'pending' | 'active' | 'running' | 'complete';

  /** Nesting depth for indentation */
  depth?: number;

  /** Whether this block is highlighted */
  isHighlighted?: boolean;

  /** Whether this block is currently active */
  isActive?: boolean;

  /** Compact mode for smaller displays */
  compact?: boolean;

  /** Additional actions to render on the right */
  actions?: React.ReactNode;

  /** Additional CSS classes */
  className?: string;

  /** Click handler */
  onClick?: () => void;

  /** Hover handlers */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/**
 * BlockDisplay - Runtime block with colored metrics metrics
 */
export const BlockDisplay: React.FC<BlockDisplayProps> = ({
  label,
  blockType,
  metrics,
  status,
  depth = 0,
  isHighlighted = false,
  isActive = false,
  compact = false,
  actions,
  className,
  onClick,
  onMouseEnter,
  onMouseLeave
}) => {
  const statusColorClass = {
    complete: 'bg-signal-positive',
    active: 'bg-primary',
    running: 'bg-primary animate-pulse',
    pending: 'bg-muted-foreground'
  }[status || 'pending'];

  const handleBlockKeyDown = onClick
    ? (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }
    : undefined;

  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b border-border/40 transition-colors',
        compact ? 'py-1 px-1.5' : 'py-1.5 px-2',
        isHighlighted && 'bg-primary/10',
        isActive && 'bg-muted/50 font-medium',
        !isHighlighted && !isActive && 'hover:bg-muted/30',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
      onKeyDown={handleBlockKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Indentation */}
      {depth > 0 && (
        <div
          className="flex-shrink-0 border-l border-border/30"
          style={{
            width: `${depth * 12}px`,
            height: '16px',
            marginRight: '4px'
          }}
        />
      )}

      {/* Status indicator */}
      <div className={cn('w-2 h-2 rounded-full flex-shrink-0', statusColorClass)} />

      {/* Label */}
      <span className={cn(
        'flex-shrink-0 text-sm truncate max-w-[120px]',
        status === 'complete' && 'line-through opacity-60'
      )}>
        {label}
      </span>

      {/* Metrics as metrics */}
      {metrics && metrics.length > 0 && (
        <div className="flex-1 min-w-0">
          <MetricVisualizer
            metrics={metrics}
            className={compact ? 'gap-0.5' : 'gap-1'}
          />
        </div>
      )}

      {/* Actions or block type badge */}
      {actions || (
        <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground opacity-70 flex-shrink-0">
          {blockType}
        </span>
      )}
    </div>
  );
};

/**
 * Props for MetricList - simple list of metrics without statement wrapper
 */
export interface MetricListProps {
  /** Fragments to display */
  metrics: IMetric[];

  /** Compact mode */
  compact?: boolean;

  /** Additional CSS classes */
  className?: string;
}

/**
 * MetricList - Simple list of colored metrics tags
 */
export const MetricList: React.FC<MetricListProps> = ({
  metrics,
  compact = false,
  className
}) => {
  if (!metrics || metrics.length === 0) {
    return null;
  }

  return (
    <MetricVisualizer
      metrics={metrics}
      className={cn(compact ? 'gap-0.5' : 'gap-1', className)}
    />
  );
};

