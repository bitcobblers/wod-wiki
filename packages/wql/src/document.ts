/**
 * Query documents (wayfinder datadog-analytics ticket 17, per the query
 * documents contract).
 *
 * A query block is a self-contained document:
 *
 *   defaults [by {dim, …}] [window]
 *   <ident> = <query | expression> [(normalize <bucket>)] [-> <unit>]
 *   show <ident>, …
 *
 * A body that carries no document constructs parses as a DEGENERATE document
 * wrapping the single query — zero behavior change for legacy bodies
 * (decision ticket 22: every widget body is a document; single-line bodies
 * are degenerate documents).
 *
 * Evaluation order follows the reference graph; forward references are
 * allowed; cycles are a document-level diagnostic.
 */

import { parseQuery, type AnyParsedQuery, type PipelineSink, type QueryWindow } from './wql';
import { serialize } from './serialize';

export interface DocumentDefaults {
    groupBy?: string[];
    window?: QueryWindow;
}

export interface DocumentFormula {
    expression: string;
    /** Referenced assignment names, in appearance order. */
    references: string[];
    /** Persisted normalization intent (user-selected target bucket). */
    normalize?: string;
    /** Explicit output unit directive. */
    unit?: string;
}

export interface DocumentAssignment {
    name: string;
    kind: 'query' | 'formula';
    /** For kind 'query' — the parsed query of any family (defaults merged at run). */
    queryText?: string;
    parsed?: AnyParsedQuery;
    /** When a pipeline starts from a previously bound assignment (`kb = bench | :sum{…}`). */
    sourceRef?: string;
    /** The pipe stages after `<sourceRef> |` (`:sum{…} | :bar{…}`). */
    pipeTail?: string;
    transformsText?: string;
    formula?: DocumentFormula;
    raw: string;
}

export interface QueryDocument {
    defaults?: DocumentDefaults;
    assignments: DocumentAssignment[];
    show: string[];
    /** Optional terminal chart sink on the `show` line (`show a, b | :stacked-bar{…}`). */
    showChart?: PipelineSink;
    /** True when the body carried no document constructs (legacy single query). */
    degenerate: boolean;
}

export interface ParsedDocument {
    doc: QueryDocument;
    diagnostics: string[];
}

/** A formula expression: identifiers bound to other assignments, arithmetic,
 *  parentheses, numeric literals, and corr(a, b). */
const FORMULA_CHARS = /^[\w\s.+\-*/(),]+$/;

/** Extract referenced assignment names from a formula expression. */
function referencesOf(expression: string, known: Set<string>): string[] {
    const refs: string[] = [];
    for (const match of expression.matchAll(/[A-Za-z_][\w-]*/g)) {
        const name = match[0];
        if (known.has(name) && !refs.includes(name)) refs.push(name);
    }
    return refs;
}

/**
 * Parse a query-document body. Never throws: syntax problems surface as
 * diagnostics so one broken block never takes down a surface.
 */
export function parseDocument(text: string): ParsedDocument {
    const diagnostics: string[] = [];
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('//'));

    const defaults: DocumentDefaults = {};
    let hasDefaults = false;
    const assignments: DocumentAssignment[] = [];
    let show: string[] | undefined;
    let showChart: PipelineSink | undefined;
    let degenerate = false;

    const known = new Set<string>();

    for (const line of lines) {
        // defaults [by {…}] [window]
        if (line.startsWith('defaults ')) {
            hasDefaults = true;
            const rest = line.slice('defaults '.length).trim();
            const byMatch = /by\s*\{([^}]*)\}/.exec(rest);
            if (byMatch) {
                defaults.groupBy = byMatch[1]!.split(',').map((d) => d.trim()).filter(Boolean);
            }
            const lastMatch = /last\s+(\d+)\s*(d|w)/.exec(rest);
            if (lastMatch) {
                defaults.window = { kind: 'relative', size: Number(lastMatch[1]), unit: lastMatch[2] as 'd' | 'w' };
            }
            const fromMatch = /from\s+(\d{4}-\d{2}-\d{2})(?:\s+to\s+(\d{4}-\d{2}-\d{2}))?/.exec(rest);
            if (fromMatch) {
                defaults.window = { kind: 'range', start: fromMatch[1]!, end: fromMatch[2] };
            }
            continue;
        }

        // show a, b [| :chart{params}]
        if (line.startsWith('show ')) {
            const rest = line.slice('show '.length).trim();
            const pipeIdx = rest.indexOf('|');
            const namesPart = pipeIdx === -1 ? rest : rest.slice(0, pipeIdx).trim();
            show = namesPart.split(',').map((s) => s.trim()).filter(Boolean);
            if (pipeIdx !== -1) {
                const sinkText = rest.slice(pipeIdx + 1).trim();
                const sinkParsed = parseQuery(`:segment{} | ${sinkText}`);
                if (!sinkParsed.error && sinkParsed.family === 'pipeline' && sinkParsed.sink && sinkParsed.transforms.length === 0) {
                    showChart = sinkParsed.sink;
                } else {
                    diagnostics.push(`Invalid chart sink on show: "${sinkText}"`);
                }
            }
            continue;
        }
        // <ident> = body
        const assign = /^([A-Za-z_][\w-]*)\s*=\s*(.+)$/.exec(line);
        if (assign) {
            const name = assign[1]!;
            const body = assign[2]!.trim();
            known.add(name);

            // (normalize <bucket>) intent + -> <unit> directive
            const unitMatch = /->\s*([\w/%.]+)\s*$/.exec(body);
            const normalizeMatch = /\(normalize\s+([^)]+)\)/.exec(body);
            const expression = body
                .replace(/->\s*[\w/%.]+\s*$/, '')
                .replace(/\(normalize\s+[^)]+\)/, '')
                .trim();

            // Colon heads (`:journal{…}`, `:sum{…}`), dataset references
            // (`@today | …`), and pipe stages route to the query parser;
            // legacy `sum:`/`find:` heads keep their diagnostics.
            const looksLikeQuery = /^(sum|avg|min|max|count|last|delta|find|rows)\b|^[:@|]/.test(expression);

            if (looksLikeQuery) {
                const parsed = parseQuery(expression);
                if (!parsed.error) {
                    assignments.push({ name, kind: 'query', queryText: expression, parsed, raw: line });
                } else {
                    diagnostics.push(`Assignment "${name}" is not a valid query`);
                }
                continue;
            }

            // Named list/series pipe: `<sourceIdent> | <stages>`
            const refPipe = /^([A-Za-z_][\w-]*)\s*\|\s*(.+)$/.exec(expression);
            if (refPipe) {
                const sourceRef = refPipe[1]!;
                const pipeTail = refPipe[2]!.trim();
                const synthetic = parseQuery(`:segment{} | ${pipeTail}`);
                if (!synthetic.error && synthetic.family === 'pipeline') {
                    assignments.push({
                        name,
                        kind: 'query',
                        sourceRef,
                        pipeTail,
                        transformsText: pipeTail,
                        queryText: expression,
                        parsed: synthetic,
                        raw: line,
                    });
                } else {
                    diagnostics.push(`Assignment "${name}" is not a valid pipeline over "${sourceRef}"`);
                }
                continue;
            }

            // Formula — must reference at least one known assignment and use
            // only expression characters.
            if (!FORMULA_CHARS.test(expression)) {
                diagnostics.push(`Assignment "${name}" has characters a formula cannot parse`);
                continue;
            }
            const formula: DocumentFormula = {
                expression,
                references: [],
                ...(normalizeMatch ? { normalize: normalizeMatch[1]!.trim() } : {}),
                ...(unitMatch ? { unit: unitMatch[1] } : {}),
            };
            assignments.push({ name, kind: 'formula', formula, raw: line });
            continue;
        }

        // Not a construct — legacy single-query body?
        degenerate = true;
    }

    // Degenerate: no document constructs → wrap the single query.
    if (!hasDefaults && show === undefined && !degenerate && assignments.length === 1 && assignments[0]!.kind === 'query') {
        // A bare single query is handled below.
    }
    if (!hasDefaults && show === undefined && assignments.length === 0) {
        const parsed = parseQuery(lines.join(' '));
        // Ticket 19: any family (aggregate / rows / find) runs degenerately.
        if (!parsed.error) {
            known.add('query');
            assignments.push({ name: 'query', kind: 'query', queryText: lines.join(' '), parsed, raw: lines.join(' ') });
            show = ['query'];
            degenerate = true;
        } else {
            diagnostics.push('Body is neither a valid query nor a valid document');
        }
    }

    // Resolve formula and sourceRef references AFTER all assignments are known
    // (forward references are legal); cycles are diagnostics.
    for (const assignment of assignments) {
        if (assignment.sourceRef && !known.has(assignment.sourceRef)) {
            diagnostics.push(`Assignment "${assignment.name}" references unknown source "${assignment.sourceRef}"`);
        }
        if (assignment.kind !== 'formula' || !assignment.formula) continue;
        assignment.formula.references = referencesOf(assignment.formula.expression, known);
        // Unknown identifiers are diagnostics, not silent zeros.
        for (const match of assignment.formula.expression.matchAll(/[A-Za-z_][\w-]*/g)) {
            const name = match[0];
            if (!known.has(name)) {
                diagnostics.push(`Formula "${assignment.name}" references unknown name "${name}"`);
            }
        }
        if (assignment.formula.references.length === 0) {
            diagnostics.push(`Formula "${assignment.name}" references no named query or formula`);
        }
    }
    const cycle = findCycle(assignments);
    if (cycle) {
        diagnostics.push(`Reference cycle detected: ${cycle.join(' -> ')}`);
    }

    if (show === undefined) {
        // Default show: every query assignment (formulas surface when named).
        show = assignments.filter((a) => a.kind === 'query').map((a) => a.name);
        if (assignments.length > 0 && show.length === 0) show = [assignments[0]!.name];
    } else {
        for (const name of show) {
            if (!known.has(name)) diagnostics.push(`show references unknown name "${name}"`);
        }
    }

    return {
        doc: {
            ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
            assignments,
            show,
            ...(showChart ? { showChart } : {}),
            degenerate,
        },
        diagnostics,
    };
}

function findCycle(assignments: readonly DocumentAssignment[]): string[] | undefined {
    const deps = new Map<string, string[]>();
    for (const a of assignments) {
        if (a.kind === 'formula' && a.formula) deps.set(a.name, a.formula.references);
        else if (a.sourceRef) deps.set(a.name, [a.sourceRef]);
    }
    const state = new Map<string, 1 | 2>();
    const stack: string[] = [];
    const visit = (name: string): string[] | undefined => {
        const s = state.get(name);
        if (s === 2) return undefined;
        if (s === 1) {
            const start = stack.indexOf(name);
            return [...stack.slice(start === -1 ? 0 : start), name];
        }
        state.set(name, 1);
        stack.push(name);
        for (const ref of deps.get(name) ?? []) {
            const cycle = visit(ref);
            if (cycle) return cycle;
        }
        stack.pop();
        state.set(name, 2);
        return undefined;
    };
    for (const name of deps.keys()) {
        const cycle = visit(name);
        if (cycle) return cycle;
    }
    return undefined;
}

/** Lossless serialization: round-trips parse(serialize(parse(text))) to the
 *  same document (used by dashboards and note rendering to persist intent). */
export function serializeDocument(doc: QueryDocument): string {
    if (doc.degenerate) {
        const only = doc.assignments[0];
        return only?.queryText ?? '';
    }
    const lines: string[] = [];
    if (doc.defaults) {
        const parts: string[] = [];
        if (doc.defaults.groupBy?.length) parts.push(`by {${doc.defaults.groupBy.join(', ')}}`);
        if (doc.defaults.window) {
            const w = doc.defaults.window;
            parts.push(w.kind === 'relative' ? `last ${w.size}${w.unit}` : `from ${w.start}${w.end ? ` to ${w.end}` : ''}`);
        }
        if (parts.length > 0) lines.push(`defaults ${parts.join(' ')}`);
    }
    for (const a of doc.assignments) {
        lines.push(a.raw);
    }
    if (doc.show.length > 0) {
        let showLine = `show ${doc.show.join(', ')}`;
        if (doc.showChart) {
            const sinkSerialized = serialize({
                family: 'pipeline',
                raw: '',
                source: { kind: 'dataset', name: '@session' },
                transforms: [],
                sink: doc.showChart,
            }).replace(/^@session\s*\|\s*/, '');
            showLine += ` | ${sinkSerialized}`;
        }
        lines.push(showLine);
    }
    return lines.join('\n');
}
