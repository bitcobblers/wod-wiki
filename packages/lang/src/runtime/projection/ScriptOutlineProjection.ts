/**
 * ScriptOutlineProjection — projects the static authored statement tree alongside
 * the live runtime stack cursor without pre-compiling lazy JIT blocks.
 *
 * Also synthesizes a compact protocol format string (e.g. "20:00 AMRAP",
 * "3 Rounds", "21-15-9") from root statements for workout banners.
 */

import { MetricType, type ICodeStatement } from '@bitcobblers/wod-wiki-core';
import { CONSUMED_HINTS, hasHint, metricPresentation } from '../../metrics';
import type { IScript } from '../../parser/WhiteboardScript';
import type { IScriptRuntime } from '../contracts/IScriptRuntime';

export type ScriptOutlineStatus = 'completed' | 'active' | 'upcoming';

export interface ScriptOutlineNode {
  readonly statementId: number;
  readonly depth: number;
  readonly label: string;
  readonly status: ScriptOutlineStatus;
}

function formatStatementLabel(statement: ICodeStatement): string {
  const presented = metricPresentation
    .presentGroup(
      [...statement.metrics].filter((m) => m.type !== MetricType.Hint),
      'timer-subtitle',
    )
    .filter((t) => t.visible)
    .map((t) => t.label)
    .filter(Boolean)
    .join(' ')
    .trim();
  return presented || statement.text?.trim() || 'Step';
}

export function synthesizeWorkoutFormat(
  script: Pick<IScript, 'statements'> | null | undefined,
): string | undefined {
  const statements = script?.statements;
  if (!statements || statements.length === 0) return undefined;

  const roots = statements.filter((s) => s.parent === undefined);
  const primaryRoot = roots[0] ?? statements[0];
  if (!primaryRoot) return undefined;

  const hasChildren = (primaryRoot.children?.length ?? 0) > 0;
  const hasProtocolHint =
    hasHint(primaryRoot, CONSUMED_HINTS.LABEL_AMRAP) ||
    hasHint(primaryRoot, CONSUMED_HINTS.LABEL_EMOM) ||
    hasHint(primaryRoot, CONSUMED_HINTS.LABEL_TABATA) ||
    hasHint(primaryRoot, CONSUMED_HINTS.LABEL_FOR_TIME);
  const hasStructuralMetric = primaryRoot.metrics.some(
    (m) => m.type === MetricType.Rounds || m.type === MetricType.Duration,
  );

  if (!hasChildren && !hasProtocolHint && !hasStructuralMetric) {
    return undefined;
  }

  return formatStatementLabel(primaryRoot);
}

export function projectScriptOutline(
  runtime: IScriptRuntime | null | undefined,
): ScriptOutlineNode[] {
  const statements = runtime?.script?.statements;
  if (!runtime || !statements || statements.length === 0) return [];

  const activeIds = new Set<number>();
  for (const block of runtime.stack.blocks) {
    if (block.blockType === 'SessionRoot' || block.blockType === 'WaitingToStart') continue;
    for (const id of block.sourceIds) {
      if (typeof id === 'number') activeIds.add(id);
    }
  }

  const completedIds = new Set<number>();
  for (const out of runtime.getOutputStatements()) {
    if (out.outputType === 'segment' && typeof out.sourceStatementId === 'number') {
      completedIds.add(out.sourceStatementId);
    }
  }

  const depthOf = (stmt: ICodeStatement): number => {
    let depth = 0;
    let cur = stmt.parent;
    const seen = new Set<number>();
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      const parentStmt = runtime.script.getId(cur);
      if (!parentStmt) break;
      depth += 1;
      cur = parentStmt.parent;
    }
    return depth;
  };

  const nodes: ScriptOutlineNode[] = [];
  for (const stmt of statements) {
    if (typeof stmt.id !== 'number') continue;
    const label = formatStatementLabel(stmt);
    if (!label) continue;
    const status: ScriptOutlineStatus = activeIds.has(stmt.id)
      ? 'active'
      : completedIds.has(stmt.id)
        ? 'completed'
        : 'upcoming';
    nodes.push({
      statementId: stmt.id,
      depth: depthOf(stmt),
      label,
      status,
    });
  }

  return nodes;
}
