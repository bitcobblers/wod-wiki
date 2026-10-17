import type { Tree } from '@lezer/common';
import type { ICodeStatement, IMetric } from '@bitcobblers/wod-wiki-core';
import { MetricContainer, MetricType } from '@bitcobblers/wod-wiki-core';
import { classifyStatements } from './semantic-classifier';
import type { ParseReferences } from './semantic-classifier';
import { extractSyntaxFacts } from './syntax-parser';
import { dialectStack } from '../dialects/DialectStack';

export type SourceInput = string | { tree?: Tree; source: string; doc?: { toString(): string } } | { doc: { toString(): string } };

function resolveSourceInput(sourceOrTree: SourceInput, treeArg?: Tree): { source: string; tree?: Tree } {
  if (typeof sourceOrTree === 'string') {
    return { source: sourceOrTree, tree: treeArg };
  }
  if ('source' in sourceOrTree) {
    return { source: sourceOrTree.source, tree: treeArg ?? sourceOrTree.tree };
  }
  if ('doc' in sourceOrTree) {
    return { source: sourceOrTree.doc.toString(), tree: treeArg };
  }
  return { source: '' };
}

/**
 * Extract statements WITHOUT running the Dialect Stack.
 *
 * Used by the parser test harness (which applies its own Dialect set) and by
 * any consumer that needs the classified statements without Dialect
 * processing. Production consumers should use {@link extractStatements}.
 *
 * Inline rounds normalization still runs here so every parser entrypoint —
 * with or without dialects — produces the same deterministic Statement tree.
 */
export function extractStatementsRaw(
  sourceOrTree: SourceInput,
  treeArg?: Tree,
  references?: ParseReferences,
): ICodeStatement[] {
  const { source, tree } = resolveSourceInput(sourceOrTree, treeArg);
  const facts = extractSyntaxFacts(source, tree);
  return normalizeInlineRounds(classifyStatements(facts, references));
}

/**
 * Extracts WhiteboardScript statements from source or Lezer tree.
 *
 * The Dialect Stack (base Units + sport Dialects + personal-overrides) runs on
 * every statement here, so every parse consumer gets fused units and sport
 * hints uniformly. See `DialectStack.ts`.
 *
 * @param sport - The block's `:sport` fence suffix (` ```log:climbing `).
 *   Omitted → the full registry stack runs. See {@link DialectStack.dialectsFor}.
 */
export function extractStatements(
  sourceOrTree: SourceInput,
  sportOrTree?: string | Tree,
  sportArg?: string,
  references?: ParseReferences,
): ICodeStatement[] {
  let sport: string | undefined;
  let tree: Tree | undefined;

  if (typeof sportOrTree === 'string') {
    sport = sportOrTree;
  } else if (sportOrTree && typeof sportOrTree === 'object') {
    tree = sportOrTree as Tree;
    sport = sportArg;
  }

  const resolved = resolveSourceInput(sourceOrTree, tree);
  const facts = extractSyntaxFacts(resolved.source, resolved.tree);
  const statements = classifyStatements(facts, references);
  dialectStack.processAll(statements, sport);
  return normalizeInlineRounds(statements);
}

function isInlineRoundsPrescription(stmt: ICodeStatement): boolean {
  if (stmt.children.length > 0) return false;
  return stmt.metrics.some(m => m.type === MetricType.Rounds)
    && stmt.metrics.some(m => m.type === MetricType.Rep)
    && !stmt.metrics.some(m => m.type === MetricType.Duration);
}

function cloneStatement(stmt: ICodeStatement): ICodeStatement {
  const clone = Object.create(Object.getPrototypeOf(stmt));
  Object.assign(clone, stmt);
  return clone;
}

/**
 * Splits an inline rounds prescription (`5x5 Back Squat @100kg`, `(5) 5 …`) on
 * one source line into a parent Statement carrying the Rounds+Rep scheme and a
 * child Statement carrying movement/load/hints. Both keep the original line and
 * per-metric source slices; ids stay structural (document order), so identity is
 * independent of the physical line. Split descendants are owned exactly once —
 * by their direct parent; higher ancestors drop the stale reference.
 */
function normalizeInlineRounds(statements: ICodeStatement[]): ICodeStatement[] {
  if (!statements.some(isInlineRoundsPrescription)) return statements;

  const out: ICodeStatement[] = [];
  const oldToNew = new Map<number, number>();
  const directParentOf = new Map<number, number>();
  const childCloneOf = new Map<ICodeStatement, ICodeStatement>();
  const splitOriginOf = new Map<ICodeStatement, number>();

  for (const stmt of statements) {
    if (!isInlineRoundsPrescription(stmt)) {
      oldToNew.set(stmt.id, out.length);
      out.push(stmt);
      continue;
    }
    if (stmt.parent !== undefined) directParentOf.set(stmt.id, stmt.parent);

    const parent = cloneStatement(stmt);
    const child = cloneStatement(stmt);
    const isScheme = (m: IMetric) => m.type === MetricType.Rounds || m.type === MetricType.Rep;
    parent.metrics = MetricContainer.from(stmt.metrics.filter(isScheme), parent.id);
    child.metrics = MetricContainer.from(stmt.metrics.filter(m => !isScheme(m)), child.id);
    parent.metricMeta = new Map([...stmt.metricMeta].filter(([m]) => isScheme(m)));
    child.metricMeta = new Map([...stmt.metricMeta].filter(([m]) => !isScheme(m)));
    parent.isLeaf = false;
    child.isLeaf = true;
    parent.children = [];
    child.children = [];
    childCloneOf.set(child, parent);
    splitOriginOf.set(parent, stmt.id);
    oldToNew.set(stmt.id, out.length);
    out.push(parent, child);
  }

  return out.map((stmt, id) => {
    const oldId = stmt.id;
    stmt.id = id;
    // Rebuild containers so the metric owner equals the final statement id.
    stmt.metrics = MetricContainer.from(stmt.metrics, stmt.id);

    const parentClone = childCloneOf.get(stmt);
    if (parentClone) {
      stmt.parent = id - 1;
      return stmt;
    }
    if (splitOriginOf.has(stmt)) {
      stmt.children = [[id + 1]];
      const oldParent = directParentOf.get(splitOriginOf.get(stmt)!);
      stmt.parent = oldParent === undefined ? undefined : oldToNew.get(oldParent);
      return stmt;
    }

    stmt.parent = stmt.parent === undefined ? undefined : oldToNew.get(stmt.parent);
    stmt.children = stmt.children
      .map(group => group
        // Split descendants are owned exactly once — by their direct parent.
        .filter(childId => !directParentOf.has(childId) || directParentOf.get(childId) === oldId)
        .map(childId => oldToNew.get(childId) ?? childId))
      .filter(group => group.length > 0);
    return stmt;
  });
}
