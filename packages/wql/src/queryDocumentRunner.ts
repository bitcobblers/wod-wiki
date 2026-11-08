/**
 * QueryDocumentRunner — the ONE execution path for query documents
 * (wayfinder datadog-analytics ticket 19, per the shared query execution
 * contract). Dashboard surfaces and embedded note query documents evaluate
 * through this runner via a host adapter; no surface runs queries itself.
 *
 * Per document run:
 *   1. token substitution (`$name` → active parameter values, raw text);
 *   2. parse as a QueryDocument (degenerate single query = legacy body);
 *   3. AST rollup inspection — `calc.*`-class targets (including pipeline
 *      transform stages) trigger the host's rollup-ensure ONCE per run
 *      (never string matching over query text);
 *   4. one captured execution context threads every window resolution;
 *   5. family dispatch: aggregate → aggregate run, find → runFind,
 *      rows → runRows, pipeline → runPipeline.
 *
 * Zero browser dependencies — stores, catalog, and evaluator are injected.
 * Hosts that lack a family capability surface a diagnostic on the output —
 * never a silent empty result.
 */

import type { EventRecord, Note, BlockIndexRow } from '@bitcobblers/wod-wiki-core';
import { QueryDocumentRunner as FormulaAwareRunner, type DocumentResult, type DocumentOutput, type FormulaEvaluator, type FamilyRunPayload, appendSuffixes } from './documentRunner';
import { parseDocument, serializeDocument } from './document';
import { substituteTokens as substituteDashboardTokens } from './dashboard/model';
import { captureContext, type ExecutionContext } from './calendar';
import type { DocumentAssignment } from './document';
import type { AnyParsedQuery, QueryWindow } from './wql';
import type { RowsRun, TabularResult, NoteContainer } from './QueryService';

export interface RollupTarget {
    /** The calc target key, e.g. `calc.acwr`. */
    key: string;
}

/** Host-populated page source dataset: named standard sources (`@session`,
 *  `@today`, user names include `@`) resolved in memory before queries run. */
export interface PageSourceEntry {
    events: EventRecord[];
    notes: Note[];
}

/**
 * PageSourceRegistry — the host's named page-source store (ticket 5).
 * Constructed/populated ONCE per page load / run context, BEFORE child
 * queries evaluate. Dataset pipeline stages (`@today | :sum{…}`) read it
 * synchronously through `QueryServiceStores.datasetStore` — no database
 * roundtrip downstream.
 */
export class PageSourceRegistry extends Map<string, PageSourceEntry> {
    /** QueryService datasetStore seam alias — names include the `@`. */
    getDataset(name: string): PageSourceEntry | undefined {
        return this.get(name);
    }
}

export interface QueryDocumentRunnerHost {
    runAggregate(queryText: string, overrides: {
        groupBy?: string[];
        window?: QueryWindow;
        context?: ExecutionContext;
    }): Promise<{
        series?: DocumentOutput['series'];
        unit?: string;
        error?: string;
    }>;
    runFind?(queryText: string, context?: ExecutionContext): Promise<{
        kind: 'find';
        notes?: Note[];
        blocks?: BlockIndexRow[];
        efforts?: unknown[];
        containers?: Record<string, NoteContainer>;
        runs?: RowsRun[];
        table?: TabularResult;
        unit?: string;
        events?: EventRecord[];
        error?: string;
    }>;
    /** Pipeline execution (`:source | :fn | :chart`, `@dataset | …`) — the
     *  host's QueryService.runPipeline. */
    runPipeline?(queryText: string, context?: ExecutionContext): Promise<FamilyRunPayload>;
    /** Evaluate pipeline tail stages over an already-evaluated find payload (shared source DAG). */
    runPipelineFromFind?(sourceFind: FamilyRunPayload, pipeTail: string, context?: ExecutionContext): Promise<FamilyRunPayload>;
    /** Injected formula evaluator override (engine/app composition adapts
     *  lang's calc evaluator); the built-in pointwise evaluator otherwise. */
    formulaEvaluator?: FormulaEvaluator;
    /** Host rollup driver: recompute-on-open for `calc.*` facts. Must skip
     *  already-up-to-date prerequisites (no ensure→refresh loop). */
    rollupEnsure?: () => Promise<void>;
}

export interface SharedRunnerOptions {
    formulaEvaluator?: FormulaEvaluator;
    /** One captured execution context per document run (ticket 12). */
    context?: ExecutionContext;
    /** Host default range — applies only when the document has no window. */
    rangeStart?: number;
    rangeEnd?: number;
    /** Active token values (frontmatter controls, dashboard controls). */
    tokens?: Record<string, string>;
}

const ROLLUP_TARGETS = ['calc.acwr', 'calc.monotony', 'calc.strain'];

export class QueryDocumentRunner {
    private readonly host: QueryDocumentRunnerHost;
    private readonly initialOptions: SharedRunnerOptions;

    constructor(host: QueryDocumentRunnerHost, options: SharedRunnerOptions = {}) {
        this.host = host;
        this.initialOptions = options;
    }

    /**
     * Run one document. `runOptions` override construction-time captures
     * (tokens, context) — one capture per run. Each run gets its OWN
     * evaluation snapshot: overlapping runs (one awaiting rollupEnsure while
     * another executes) can never borrow each other's context.
     */
    async run(text: string, runOptions: SharedRunnerOptions = {}): Promise<DocumentResult> {
        const captured: SharedRunnerOptions = {
            ...this.initialOptions,
            ...runOptions,
            tokens: { ...this.initialOptions.tokens, ...runOptions.tokens },
            // One captured execution context per run (ticket 12): callers
            // that supply none still get a single capture for the run.
            context: runOptions.context ?? this.initialOptions.context ?? captureContext(),
        };

        // 1. Token substitution — raw text at execution time.
        const substituted = substituteTokens(text, captured.tokens ?? {});

        // 3. AST rollup inspection on the substituted text: a calc.* target
        // in the parsed head — including pipeline transform stages — triggers
        // the host ensure exactly once.
        const parsed = parseDocument(substituted);
        if (parsed.doc.assignments.some((a: DocumentAssignment) => consumesRollupFacts(a.parsed))) {
            await this.host.rollupEnsure?.();
        }

        // 4+5. Document evaluation — the formula-aware runner (ticket 17)
        // drives semantics; its hooks bind THIS run's snapshot. Missing host
        // capabilities surface the diagnostic on the output — never a silent
        // empty result.
        const formulaRunner = new FormulaAwareRunner(async (queryText, overrides) => {
            if (overrides.window) {
                queryText = appendSuffixes(queryText, overrides.window, overrides.groupBy);
            }
            return this.host.runAggregate(queryText, { context: captured.context, window: overrides.window });
        }, {
            // The injected evaluator (ticket 17 seam) wins; the host may also
            // carry one; otherwise the built-in evaluates.
            formulaEvaluator: captured.formulaEvaluator ?? this.host.formulaEvaluator,
            runFind: async (queryText) => {
                const res = await this.host.runFind?.(queryText, captured.context);
                return res ?? { error: 'find queries are not supported by this host' };
            },
            runPipeline: async (queryText) => {
                const res = await this.host.runPipeline?.(queryText, captured.context);
                return res ?? { error: 'pipeline queries are not supported by this host' };
            },
            ...(this.host.runPipelineFromFind
                ? {
                      runPipelineFromFind: async (sourceFind: FamilyRunPayload, pipeTail: string) =>
                          this.host.runPipelineFromFind!(sourceFind, pipeTail, captured.context),
                  }
                : {}),
        });
        return formulaRunner.run(substituted);
    }
}

/** Substitute `$name` tokens with active parameter values (raw text). */
export function substituteTokens(text: string, tokens: Record<string, string>): string {
    return substituteDashboardTokens(text, tokens).query;
}

/**
 * AST rollup inspection (replaces `.includes('calc.')` string sniffing):
 * true when the parsed head's metric — a pipeline's source aggregate metric
 * or any transform stage's — is a calc target whose derivation depends on
 * workload rollup facts.
 */
export function consumesRollupFacts(parsed: AnyParsedQuery | undefined): boolean {
    if (!parsed) return false;
    if (parsed.family === 'aggregate') return ROLLUP_TARGETS.includes(parsed.metric);
    if (parsed.family === 'pipeline') {
        if (parsed.source.kind === 'query' && parsed.source.query.family === 'aggregate'
            && ROLLUP_TARGETS.includes(parsed.source.query.metric)) return true;
        return parsed.transforms.some((t) => ROLLUP_TARGETS.includes(t.metric));
    }
    return false;
}

/** Re-export for surface parity with the ticket-17 module. */
export { parseDocument, serializeDocument };
