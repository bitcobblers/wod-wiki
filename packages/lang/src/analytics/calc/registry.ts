/**
 * Calculation registry — registration and static validation of composed
 * calculation DAG records (spec §2.2).
 *
 * Every expression and predicate is parsed and dimension-checked at
 * registration (spec §5): unknown symbols, dimension mismatches, bad
 * convert targets, and invalid output units fail here, never at runtime.
 * Library calcs register their node dimensions under qualified names
 * (`calcId.nodeId`) so dependent calcs can reference them statically.
 */

import { ExprNode } from './ast';
import { CalcRegistrationError, inferDim, StaticEnv, validateOutputUnit } from './check';
import { DimVector, DIM_ZERO } from './dimensions';
import { LookupRegistry } from './lookup';
import { parseExpression } from './parser';
import { AGGREGATE_BUILTINS, CONTEXT_ATOMS, STREAM_ATOMS } from './atoms';
import { AUTHORITATIVE_CASTS } from './units';
import { CalculationDefinition, CalcScope, CalcVariant } from './types';

export class CalculationRegistry {
  private readonly defs = new Map<string, CalculationDefinition>();
  /** Qualified library node dimensions: `calcId.nodeId` → vector. */
  private readonly libraryDims = new Map<string, DimVector>();

  constructor(private readonly lookups: LookupRegistry) {}

  /** All registered calcs for a scope, registration order preserved. */
  byScope(scope: CalcScope): CalculationDefinition[] {
    return [...this.defs.values()].filter((d) => d.scope === scope);
  }

  get(id: string): CalculationDefinition | undefined {
    return this.defs.get(id);
  }

  /** Register a custom statement-level metric dimension (e.g. from a Property Note). */
  registerAtom(name: string, dim: DimVector = DIM_ZERO): void {
    this.libraryDims.set(name, dim);
  }

  /**
   * Register a calculation. Compiles every node expression and predicate,
   * runs static dimension checking, and (for library calcs) publishes node
   * dimensions for dependent calcs. Throws CalcRegistrationError on any
   * violation.
   */
  register(def: CalculationDefinition): void {
    if (def.variants.length === 0) {
      throw new CalcRegistrationError(`Calc ${def.id}: at least one variant is required`);
    }
    if (def.customAtoms) {
      for (const [atom, dim] of Object.entries(def.customAtoms)) {
        this.libraryDims.set(atom, dim);
      }
    }
    const env = this.staticEnv();
    if (def.when) def.whenAst = compilePredicate(def.when, def.id, env);

    // Sort variants once: higher priority first, registration order breaks ties.
    def.variants = [...def.variants].sort((a, b) => b.priority - a.priority);

    for (const variant of def.variants) {
      this.compileVariant(def, variant, env);
    }

    if (def.kind === 'output' && def.output?.unit && def.output.unit !== 'auto') {
      for (const variant of def.variants) {
        for (const nodeId of outputNodeIds(def)) {
          const dim = variant.nodeDims?.[nodeId];
          if (dim) validateOutputUnit(dim, def.output.unit);
        }
      }
    }

    if (def.kind === 'library') {
      for (const variant of def.variants) {
        for (const [nodeId, dim] of Object.entries(variant.nodeDims ?? {})) {
          this.libraryDims.set(`${def.id}.${nodeId}`, dim);
        }
      }
    }
    this.defs.set(def.id, def);
  }

  /** Parse + dimension-check every node and predicate in a variant. */
  private compileVariant(def: CalculationDefinition, variant: CalcVariant, baseEnv: StaticEnv): void {
    if (variant.when) variant.whenAst = compilePredicate(variant.when, `${def.id}:${variant.id}`, baseEnv);

    const nodeDims: Record<string, DimVector> = {};
    const visiting = new Set<string>();
    // Sibling refs resolve recursively, so declaration order doesn't matter
    // and cycles fail as registration errors.
    const resolveNode = (nodeId: string): DimVector => {
      if (nodeDims[nodeId]) return nodeDims[nodeId];
      const node = variant.nodes[nodeId];
      if (!node) throw new CalcRegistrationError(`Unknown symbol: ${nodeId}`);
      if (visiting.has(nodeId)) {
        throw new CalcRegistrationError(`Calc ${def.id}:${variant.id}.${nodeId}: cyclic node reference`);
      }
      visiting.add(nodeId);
      try {
        const ast = node.ast ?? parseExpression(requiredExpression(def, variant, nodeId, node.expression));
        node.ast = ast;
        const env = this.staticEnv(siblingRefDim);
        let dim = inferDim(ast, env);
        if (node.unit) {
          validateOutputUnit(dim, node.unit);
          if (AUTHORITATIVE_CASTS[node.unit]) dim = DIM_ZERO;
        }
        nodeDims[nodeId] = dim;
        return dim;
      } catch (err) {
        throw wrap(def, variant, nodeId, err);
      } finally {
        visiting.delete(nodeId);
      }
    };
    const siblingRefDim = (name: string): DimVector | undefined => {
      if (!(name in variant.nodes)) return undefined;
      return resolveNode(name);
    };

    for (const nodeId of Object.keys(variant.nodes)) resolveNode(nodeId);
    variant.nodeDims = nodeDims;
  }

  /** Static environment for a calc: siblings → library → stream → context. */
  private staticEnv(
    siblingRefDim: (name: string) => DimVector | undefined = () => undefined,
  ): StaticEnv {
    return {
      refDim: (name) =>
        siblingRefDim(name)
        ?? this.libraryDims.get(name)
        ?? STREAM_ATOMS[name]?.dim
        ?? CONTEXT_ATOMS[name],
      callDim: (name, argDims) => {
        if (name === 'count') return DIM_ZERO;
        if (AGGREGATE_BUILTINS[name]) return argDims[0];
        return undefined;
      },
      lookupDim: (table, field) => this.lookups.fieldDim(table, field),
    };
  }
}

function compilePredicate(src: string, owner: string, env: StaticEnv): ExprNode {
  try {
    const ast = parseExpression(src);
    inferDim(ast, env);
    return ast;
  } catch (err) {
    if (err instanceof Error) throw new CalcRegistrationError(`Calc ${owner} predicate: ${err.message}`);
    throw err;
  }
}

function requiredExpression(def: CalculationDefinition, variant: CalcVariant, nodeId: string, expression: string | undefined): string {
  if (!expression) {
    throw new CalcRegistrationError(`Calc ${def.id}:${variant.id}.${nodeId}: node needs an expression or AST`);
  }
  return expression;
}

function wrap(def: CalculationDefinition, variant: CalcVariant, nodeId: string, err: unknown): Error {
  if (err instanceof Error) {
    return new CalcRegistrationError(`Calc ${def.id}:${variant.id}.${nodeId}: ${err.message}`);
  }
  return err as Error;
}

/** Output node ids as an array regardless of the single/multi form. */
export function outputNodeIds(def: CalculationDefinition): string[] {
  const nodeId = def.output?.nodeId;
  if (!nodeId) return [];
  return Array.isArray(nodeId) ? nodeId : [nodeId];
}
