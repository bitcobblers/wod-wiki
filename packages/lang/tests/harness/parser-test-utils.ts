/**
 * Parser Test Utilities
 *
 * Parse-level counterpart to SessionTestContext. Parses Whiteboard Script text
 * through the full dialect stack and provides structured assertion helpers for
 * CodeStatement trees and metrics. No runtime, no clock, no JIT — just the
 * language layer.
 *
 * Usage:
 *   import { parse } from '../helpers/parser-test-utils';
 *   parse('10 Pullups').roots()[0].hasMetric(MetricType.Rep);
 */
import { createParser } from '@bitcobblers/wod-wiki-engine';
import { WhiteboardScript } from '@bitcobblers/wod-wiki-engine';
import { ICodeStatement } from '@bitcobblers/wod-wiki-engine';
import { IMetric, MetricType } from '@bitcobblers/wod-wiki-engine';
import { MetricContainer } from '@bitcobblers/wod-wiki-engine';
import { IDialect } from '@bitcobblers/wod-wiki-engine';

export class DialectRegistry {
  private dialects: Map<string, IDialect> = new Map();
  register(dialect: IDialect): void {
    this.dialects.set(dialect.id, dialect);
  }
  unregister(dialectId: string): void {
    this.dialects.delete(dialectId);
  }
  get(dialectId: string): IDialect | undefined {
    return this.dialects.get(dialectId);
  }
  getRegisteredIds(): string[] {
    return Array.from(this.dialects.keys());
  }
  process(statement: ICodeStatement): void {
    for (const dialect of this.dialects.values()) {
      dialect.transform?.(statement);
      const analysis = dialect.analyze(statement);
      if (analysis.metrics?.length) {
        statement.metrics.add(...analysis.metrics);
      }
    }
  }
  processAll(statements: ICodeStatement[]): void {
    for (const statement of statements) {
      this.process(statement);
    }
  }
  clear(): void {
    this.dialects.clear();
  }
}

import { getHints, hasHint } from '@bitcobblers/wod-wiki-engine';

import { UnitsDialect } from '@bitcobblers/wod-wiki-engine';
import { CrossFitDialect } from '@bitcobblers/wod-wiki-engine';
import { WodDialect } from '@bitcobblers/wod-wiki-engine';
import { CardioDialect } from '@bitcobblers/wod-wiki-engine';
import { YogaDialect } from '@bitcobblers/wod-wiki-engine';
import { HabitsDialect } from '@bitcobblers/wod-wiki-engine';
import { ClimbDialect } from '@bitcobblers/wod-wiki-engine';

// ── Dialect presets ───────────────────────────────────────────────

/** All production dialects in registration order. */
export const ALL_DIALECTS: IDialect[] = [
    new UnitsDialect(),
    new CrossFitDialect(),
    new WodDialect(),
    new CardioDialect(),
    new YogaDialect(),
    new HabitsDialect(),
    new ClimbDialect(),
];

/** Create a DialectRegistry from a list of dialects. */
function registryFrom(dialects: IDialect[]): DialectRegistry {
    const r = new DialectRegistry();
    for (const d of dialects) r.register(d);
    return r;
}

// ── Options ───────────────────────────────────────────────────────

export interface ParserTestOptions {
    /**
     * Dialects to register. Defaults to ALL_DIALECTS (full production stack).
     * Pass `[]` for pure parser output (no dialect processing).
     * Pass a subset to test specific dialect interactions.
     */
    dialects?: IDialect[];
}

// ── Context ───────────────────────────────────────────────────────

export interface ParserTestContext {
    /** The original script text. */
    readonly source: string;
    /** The parsed WhiteboardScript. */
    readonly script: WhiteboardScript;
    /** All statements after parsing + dialect processing. */
    readonly statements: readonly ICodeStatement[];
    /** The DialectRegistry used (for inspection). */
    readonly dialects: DialectRegistry;
    /** Parse errors, if any. */
    readonly errors: readonly unknown[];
}

// ── Factory ───────────────────────────────────────────────────────

/**
 * Creates a parser test context: parse script text through the dialect stack.
 * This is the parse-only equivalent of createSessionContext().
 */
export function createParserContext(
    scriptText: string,
    options?: ParserTestOptions,
): ParserTestContext {
    const dialectList = options?.dialects ?? ALL_DIALECTS;
    const actualDialects = dialectList.some(d => d instanceof UnitsDialect)
        ? dialectList
        : [new UnitsDialect(), ...dialectList];
    const registry = registryFrom(actualDialects);

    const script = createParser().readWithoutDialects(scriptText) as WhiteboardScript;

    // Apply dialect processing to all parsed statements.
    const stmts = script.statements as ICodeStatement[];
    registry.processAll(stmts);

    return {
        source: scriptText,
        script,
        statements: stmts,
        dialects: registry,
        errors: script.errors ?? [],
    };
}

/**
 * Creates a parser test context from a pre-parsed WhiteboardScript.
 * Use with TestScript.fromScript() to avoid double-parsing.
 */
export function createParserContextFromScript(
    script: WhiteboardScript,
    options?: ParserTestOptions,
): ParserTestContext {
    const dialectList = options?.dialects ?? ALL_DIALECTS;
    const actualDialects = dialectList.some(d => d instanceof UnitsDialect)
        ? dialectList
        : [new UnitsDialect(), ...dialectList];
    const registry = registryFrom(actualDialects);

    // Apply dialect processing to all parsed statements.
    const stmts = script.statements as ICodeStatement[];
    registry.processAll(stmts);
    return {
        source: '',
        script,
        statements: stmts,
        dialects: registry,
        errors: script.errors ?? [],
    };
}

// ═══════════════════════════════════════════════════════════════════
// StatementAssertions — fluent API for a single ICodeStatement
// ═══════════════════════════════════════════════════════════════════

export class StatementAssertions {
    constructor(
        private readonly stmt: ICodeStatement,
        private readonly ctx: ParserTestContext,
    ) {}

    // ── Identity ──────────────────────────────────────────────

    /** Assert this statement has the given number of child groups. */
    hasChildren(count: number): this {
        const actual = this.stmt.children.reduce((sum, g) => sum + g.length, 0);
        if (actual !== count) {
            throw new Error(
                `Expected ${count} children, got ${actual} (groups: ${JSON.stringify(this.stmt.children)})`,
            );
        }
        return this;
    }

    /** Assert this statement has the given number of child groups (groups, not flat children). */
    hasChildGroups(count: number): this {
        if (this.stmt.children.length !== count) {
            throw new Error(
                `Expected ${count} child groups, got ${this.stmt.children.length}`,
            );
        }
        return this;
    }

    /** Assert this statement is a leaf (no children). */
    isLeaf(): this {
        const flat = this.stmt.children.reduce((s, g) => s + g.length, 0);
        if (flat > 0) {
            throw new Error(`Expected leaf statement, but it has ${flat} children`);
        }
        return this;
    }

    /** Assert this statement is a root (no parent). */
    isRoot(): this {
        if (this.stmt.parent != null) {
            throw new Error(`Expected root statement, but parent is ${this.stmt.parent}`);
        }
        return this;
    }

    /** Assert this statement has the given parent. */
    hasParent(parent: StatementAssertions | number): this {
        const expectedId = typeof parent === 'number' ? parent : parent.raw().id;
        if (this.stmt.parent !== expectedId) {
            throw new Error(
                `Expected parent ${expectedId}, got ${this.stmt.parent}`,
            );
        }
        return this;
    }

    // ── Metrics ───────────────────────────────────────────────

    /** Assert the statement has a metric of the given type. */
    hasMetric(type: MetricType | string): this {
        if (!this.stmt.hasMetric(type as MetricType)) {
            const present = this.metricTypes();
            throw new Error(
                `Expected metric "${type}" not found. Present: [${present.join(', ')}]`,
            );
        }
        return this;
    }

    /** Assert the statement does NOT have a metric of the given type. */
    lacksMetric(type: MetricType | string): this {
        if (this.stmt.hasMetric(type as MetricType)) {
            throw new Error(`Did not expect metric "${type}" to be present`);
        }
        return this;
    }

    /** Assert a specific metric's value (strict equality). */
    hasMetricValue(type: MetricType | string, value: unknown): this {
        const m = this.getMetric(type as MetricType);
        if (!m) {
            throw new Error(`Metric "${type}" not found`);
        }
        if (m.value !== value) {
            throw new Error(
                `Expected metric "${type}" value ${JSON.stringify(value)}, got ${JSON.stringify(m.value)}`,
            );
        }
        return this;
    }

    /** Assert a numeric metric value within tolerance. */
    hasMetricNear(type: MetricType | string, value: number, tolerance: number = 0.001): this {
        const m = this.getMetric(type as MetricType);
        if (!m) {
            throw new Error(`Metric "${type}" not found`);
        }
        const actual = typeof m.value === 'number' ? m.value : Number(m.value);
        if (Math.abs(actual - value) > tolerance) {
            throw new Error(
                `Expected metric "${type}" ≈ ${value} (±${tolerance}), got ${actual}`,
            );
        }
        return this;
    }

    /** Assert the total number of raw metrics on this statement. */
    hasMetricCount(count: number): this {
        const actual = this.stmt.metrics.length;
        if (actual !== count) {
            throw new Error(`Expected ${count} metrics, got ${actual}`);
        }
        return this;
    }

    /** Get all metric types present on this statement. */
    metricTypes(): string[] {
        return this.stmt.rawMetrics.map(m => m.type as string);
    }

    /** Get a specific metric (or undefined). */
    getMetric<T = unknown>(type: MetricType | string): IMetric<T> | undefined {
        return this.stmt.getMetric(type as MetricType) as IMetric<T> | undefined;
    }

    /** Get the raw MetricContainer for advanced queries. */
    metrics(): MetricContainer {
        return this.stmt.metrics instanceof MetricContainer
            ? this.stmt.metrics
            : MetricContainer.from(this.stmt.metrics as IMetric[], this.stmt.id);
    }
    // ── Group / Lap Markers ──────────────────────────────────

    /** Assert the statement has a Group metric with the given value (compose/round). */
    hasGroupMarker(groupType: string): this {
        const m = this.getMetric(MetricType.Group);
        if (!m) {
            throw new Error(`Expected Group metric, not found. Present: [${this.metricTypes().join(', ')}]`);
        }
        if (m.value !== groupType) {
            throw new Error(`Expected Group metric value "${groupType}", got "${m.value}"`);
        }
        return this;
    }

    /** Assert the statement has a required-timer hint (from * prefix). */
    isRequiredTimer(): this {
        return this.hasHint('behavior.required_timer');
    }

    /** Assert a metric of the given type has a specific origin. */
    hasMetricOrigin(type: MetricType | string, origin: string): this {
        const m = this.raw().rawMetrics.find(
            r => r.type === type && r.origin === origin,
        );
        if (!m) {
            const candidates = this.raw().rawMetrics
                .filter(r => r.type === type)
                .map(r => `origin=${r.origin}`);
            throw new Error(
                `Expected metric "${type}" with origin "${origin}". ` +
                (candidates.length
                    ? `Found: [${candidates.join(', ')}]`
                    : `Metric "${type}" not found at all`),
            );
        }
        return this;
    }
    // ── Hints (dialect-emitted) ───────────────────────────────

    /** Assert the statement carries the given dot-namespaced hint. */
    hasHint(hint: string): this {
        if (!hasHint(this.stmt, hint)) {
            throw new Error(
                `Expected hint "${hint}" not found. Present: [${this.hints().join(', ')}]`,
            );
        }
        return this;
    }

    /** Assert the statement does NOT carry the given hint. */
    lacksHint(hint: string): this {
        if (hasHint(this.stmt, hint)) {
            throw new Error(`Did not expect hint "${hint}" to be present`);
        }
        return this;
    }

    /** Assert the exact set of hints (order-insensitive). */
    hasExactHints(expected: string[]): this {
        const actual = this.hints().sort();
        const exp = [...expected].sort();
        const mismatch = [
            ...exp.filter(h => !actual.includes(h)).map(h => `missing: ${h}`),
            ...actual.filter(h => !exp.includes(h)).map(h => `extra: ${h}`),
        ];
        if (mismatch.length) {
            throw new Error(`Hint mismatch: ${mismatch.join('; ')}`);
        }
        return this;
    }

    /** Get all hint strings on this statement. */
    hints(): string[] {
        return getHints(this.stmt);
    }

    // ── Structure ─────────────────────────────────────────────

    /** Get resolved child statements. */
    children(): StatementAssertions[] {
        const ids = this.stmt.children.flat();
        return ids
            .map(id => this.ctx.script.getId(id))
            .filter((s): s is ICodeStatement => s != null)
            .map(s => new StatementAssertions(s, this.ctx));
    }

    /** Access the raw ICodeStatement for custom assertions. */
    raw(): ICodeStatement {
        return this.stmt;
    }

    /** Get the statement's raw source text (from meta). */
    sourceLine(): string {
        return this.stmt.meta?.raw ?? '';
    }

    /** Assert the statement's raw source text matches. */
    hasSource(text: string): this {
        const actual = this.sourceLine();
        if (actual !== text) {
            throw new Error(
                `Expected source "${text}", got "${actual}"`,
            );
        }
        return this;
    }

    /** Assert the statement's isLeaf flag. */
    isLeafFlag(value: boolean): this {
        if (this.stmt.isLeaf !== value) {
            throw new Error(
                `Expected isLeaf=${value}, got ${this.stmt.isLeaf}`,
            );
        }
        return this;
    }
}

// ═══════════════════════════════════════════════════════════════════
// TreeAssertions — whole-tree queries and assertions
// ═══════════════════════════════════════════════════════════════════

export class TreeAssertions {
    constructor(private readonly ctx: ParserTestContext) {}

    /** Assert total number of statements in the tree. */
    hasStatementCount(count: number): this {
        const actual = this.ctx.statements.length;
        if (actual !== count) {
            throw new Error(`Expected ${count} statements, got ${actual}`);
        }
        return this;
    }

    /** Assert number of root-level statements (no parent). */
    hasRootCount(count: number): this {
        const actual = this.roots().length;
        if (actual !== count) {
            throw new Error(`Expected ${count} root statements, got ${actual}`);
        }
        return this;
    }

    /** Get root-level statements (those with no parent). */
    roots(): StatementAssertions[] {
        return this.ctx.statements
            .filter(s => s.parent == null)
            .map(s => new StatementAssertions(s, this.ctx));
    }

    /** Find statements matching a predicate. */
    where(predicate: (s: StatementAssertions) => boolean): StatementAssertions[] {
        return this.all().filter(predicate);
    }

    /** Find the first statement containing a specific metric type. */
    findByMetric(type: MetricType | string): StatementAssertions | undefined {
        return this.all().find(s => s.hasMetric(type));
    }

    /** Find the first statement with a specific hint. */
    findByHint(hint: string): StatementAssertions | undefined {
        return this.all().find(s => {
            try { s.hasHint(hint); return true; } catch { return false; }
        });
    }

    /** Get all statements as a flat array of assertions. */
    all(): StatementAssertions[] {
        return this.ctx.statements.map(s => new StatementAssertions(s, this.ctx));
    }

    /** Assert parse errors are present. */
    hasErrors(): this {
        if (!this.ctx.errors.length) {
            throw new Error('Expected parse errors, but got none');
        }
        return this;
    }

    /** Assert no parse errors. */
    hasNoErrors(): this {
        if (this.ctx.errors.length) {
            throw new Error(
                `Expected no parse errors, got ${this.ctx.errors.length}: ${JSON.stringify(this.ctx.errors)}`,
            );
        }
        return this;
    }

    /** Assert a specific error count. */
    hasErrorCount(count: number): this {
        if (this.ctx.errors.length !== count) {
            throw new Error(
                `Expected ${count} errors, got ${this.ctx.errors.length}`,
            );
        }
        return this;
    }

    /** Access the underlying context for custom queries. */
    context(): ParserTestContext {
        return this.ctx;
    }

    /** Get a specific root by index (0-based). */
    root(index: number): StatementAssertions {
        const roots = this.roots();
        if (index >= roots.length) {
            throw new Error(`Root index ${index} out of range (${roots.length} roots)`);
        }
        return roots[index];
    }

    /** Get a statement by its array index (0-based). */
    statementAt(index: number): StatementAssertions {
        if (index >= this.ctx.statements.length) {
            throw new Error(
                `Statement index ${index} out of range (${this.ctx.statements.length} statements)`,
            );
        }
        return new StatementAssertions(this.ctx.statements[index], this.ctx);
    }
}

// ═══════════════════════════════════════════════════════════════════
// Convenience entry point
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse Whiteboard Script text and return a TreeAssertions for immediate
 * assertion. This is the primary entry point for parser compliance tests.
 *
 * @example
 *   parse('10 Pullups').roots()[0].hasMetric(MetricType.Rep);
 *   parse('(3)\n  5 Pullups', { dialects: [] }).hasStatementCount(2);
 */
export function parse(
    scriptText: string,
    options?: ParserTestOptions,
): TreeAssertions {
    const ctx = createParserContext(scriptText, options);
    return new TreeAssertions(ctx);
}

/**
 * Create TreeAssertions from a pre-parsed WhiteboardScript.
 * Pairs with TestScript.fromScript() for parse-once-assert-twice tests.
 */
export function parseFromScript(
    script: WhiteboardScript,
    options?: ParserTestOptions,
): TreeAssertions {
    const ctx = createParserContextFromScript(script, options);
    return new TreeAssertions(ctx);
}
