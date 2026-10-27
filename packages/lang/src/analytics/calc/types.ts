/**
 * Canonical Node DAG records (spec §2.2) — the storage/registration form for
 * calculations. Seeds are TS object literals (#849); the line-form parser
 * (#863) must round-trip these losslessly.
 */

import { ExprNode } from './ast';
import type { DimVector } from './dimensions';

export type CalcOrigin = 'analyzed' | 'analyzed-estimated' | 'user';
export type CalcScope = 'segment' | 'workout' | 'store';

/** A note summary that failed registration — surfaced, never silently dropped. */
export interface CalcRegistrationDiagnostic {
  /** The summary calc id that failed to register. */
  id: string;
  /** Why it was skipped (the registration error message). */
  message: string;
}

export interface CalcNode {
  id: string;
  kind: 'metric' | 'lookup' | 'builtin' | 'wql' | 'expr';
  expression?: string;
  ast?: ExprNode;
  /**
   * Declared node unit. Named zero-vector casts (AU, pts, MET-min, ratio)
   * override the computed vector (§5.3 applied to intermediate nodes —
   * required by TIS-shaped formulas that fold time into a score); any other
   * unit must match the computed vector.
   */
  unit?: string;
}

export interface CalcVariant {
  id: string;
  priority: number;
  when?: string;
  whenAst?: ExprNode;
  origin: CalcOrigin;
  nodes: Record<string, CalcNode>;
  /** Node dimensions computed at registration (static check output). */
  nodeDims?: Record<string, DimVector>;
}

export interface CalculationDefinition {
  id: string;
  kind: 'output' | 'library';
  scope: CalcScope;
  fences?: string[];
  when?: string;
  whenAst?: ExprNode;
  variants: CalcVariant[];
  /** Custom statement-level atom dimensions contributed by Property Notes. */
  customAtoms?: Readonly<Record<string, DimVector>>;
  output?: {
    nodeId: string | string[];
    key?: string;
    emitType?: string;
    unit?: string;
    isGrouped?: boolean;
    /** Group dimensions for grouped emission (e.g. ['effort']). */
    groupBy?: string[];
    publishMetadataNodes?: string[];
    /** Display label for published facts (store-scope rollups). */
    label?: string;
  };
}
