import type { ICodeStatement } from '../models/CodeStatement';
import type { WorkoutResults } from './results';

/**
 * State of a WOD block
 */
export type ScriptBlockState =
  | 'idle'
  | 'parsing'
  | 'parsed'
  | 'error'
  | 'starting'
  | 'running'
  | 'paused'
  | 'completed'
  | 'stopped';

/**
 * Parse error information
 */
export interface ParseError {
  message: string;
  line?: number;
  column?: number;
  token?: unknown;
  excerpt?: string;
  severity?: 'error' | 'warning' | 'info';
}

/** Workout fence tags — `time` is runnable, `log` is recorded */
export type FenceDialect = 'time' | 'log';

/** Ordered list of recognised workout fence tags */
export const VALID_FENCE_DIALECTS: FenceDialect[] = ['time', 'log'];

/**
 * Run affordance for a fence base tag:
 * `'time'` -> `'run'` (runnable) · `'log'` -> `'log'` (log-mode runtime) · else `null`.
 */
export function runAffordance(baseTag: string): 'run' | 'log' | null {
  if (baseTag === 'time') return 'run';
  if (baseTag === 'log') return 'log';
  return null;
}

/** Section types the editor can parse and render */
export type SectionType =
  | 'title'
  | 'markdown'
  | 'time'
  | 'log'
  | 'frontmatter'
  | 'embed'
  | 'code'
  | 'widget'
  | 'query';

/** Workout section types — the runnable/recorded fence tags */
export type WorkoutSectionType = Extract<SectionType, FenceDialect>;

/** Type guard for workout sections */
export function isWorkoutSectionType(type: SectionType): type is WorkoutSectionType {
  return type === 'time' || type === 'log';
}

/**
 * Typed front matter subtypes. `effort`/`equipment` are registry definition
 * notes (family `markdown/efforts|equipment/<slug>.md`).
 */
export type FrontMatterSubtype = 'default' | 'youtube' | 'strava' | 'amazon' | 'file' | 'effort' | 'equipment';

/**
 * Represents a single WOD block within the markdown document
 */
export interface ScriptBlock {
  /** Unique identifier for this block */
  id: string;
  /** Cross-note content fingerprint, never occurrence identity. */
  contentId?: string;
  /** Workout fence tag ('time' runnable / 'log' recorded) */
  dialect?: FenceDialect;
  /** Sport suffix from the fence */
  sport?: string;
  /** Line number where ```time/```log appears (0-indexed) */
  startLine: number;
  /** Line number where closing ``` appears (0-indexed) */
  endLine: number;
  /** Raw text content of the WOD block */
  content: string;
  /** Parsed statements (populated after parsing) */
  statements?: ICodeStatement[];
  /** Parse errors, if any */
  errors?: ParseError[];
  /** Execution state */
  state: ScriptBlockState;
  /** Collected workout data (after completion) */
  results?: WorkoutResults;
  /** Block version */
  version: number;
  /** Creation timestamp */
  createdAt: number;
}

/**
 * A single section in the document — the atomic unit of display and editing.
 */
export interface Section {
  id: string;
  contentId?: string;
  type: SectionType;
  /** Half-open UTF-16 offsets in the exact authored document. */
  from: number;
  to: number;
  contentFrom?: number;
  contentTo?: number;
  querySuffix?: string;
  separatorAfter?: string;
  subtype?: string;
  rawContent: string;
  displayContent: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  level?: number;
  sport?: string;
  widgetName?: string;
  queryType?: string;
  queryError?: string;
  scriptBlock?: ScriptBlock;
  properties?: Record<string, string>;
  frontmatterType?: FrontMatterSubtype;
  embed?: {
    type: 'image' | 'link' | 'youtube';
    label: string;
    url: string;
    isImage: boolean;
  };
  version: number;
  createdAt: number;
  deleted?: boolean;
}

/**
 * The full document as an ordered section list.
 */
export interface SectionDocument {
  sections: Section[];
  totalLines: number;
  activeSectionId: string | null;
}
