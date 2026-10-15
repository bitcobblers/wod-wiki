/**
 * CLI Output Formatters (JSON, ASCII Table, CSV)
 *
 * Implements presentation formatting for parse-tree, execution-log,
 * and WQL query results across json, table, and csv formats.
 */

import type { WodWikiIRFile, StatementNode, ExecutionLog } from '@bitcobblers/wod-wiki-engine';
import type { QueryResult, RowsQueryResult, FindQueryResult, PipelineResult } from '@bitcobblers/wod-wiki-wql';

export type OutputFormat = 'json' | 'table' | 'csv';

function escapeCsvField(field: unknown): string {
  if (field === undefined || field === null) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDate(ts: number): string {
  if (!ts) return '-';
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
}

function formatMetricValue(m: { image?: string; value?: unknown }): string {
  if (m.image) return m.image;
  if (m.value === undefined || m.value === null) return '';
  if (typeof m.value === 'object') return JSON.stringify(m.value);
  return String(m.value);
}

function formatMetric(m: { type?: string; image?: string; value?: unknown }): string {
  const t = m.type || 'metric';
  return `${t}:${formatMetricValue(m)}`;
}

/**
 * Format StatementNode parse tree
 */
export function formatParseOutput(
  ir: WodWikiIRFile<StatementNode>,
  format: OutputFormat,
  pretty: boolean = true,
): string {
  if (format === 'json') {
    return JSON.stringify(ir, null, pretty ? 2 : undefined);
  }

  // Flatten nodes for table/csv representation
  const flatNodes: StatementNode[] = [];
  const walk = (node: StatementNode) => {
    flatNodes.push(node);
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(ir.data);

  if (format === 'csv') {
    const header = 'id,type,from,to,raw,metrics,hints';
    const rows = flatNodes.map((n) =>
      [
        n.id,
        n.type,
        n.from,
        n.to,
        escapeCsvField(n.raw),
        escapeCsvField(n.metrics.map(formatMetric).join('; ')),
        escapeCsvField(n.hints?.join('; ') ?? ''),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  // format === 'table'
  const lines: string[] = [];
  lines.push(`Parse Tree (${flatNodes.length} statements):`);
  lines.push('─'.repeat(80));
  lines.push(
    ['ID'.padEnd(6), 'Type'.padEnd(12), 'Span'.padEnd(12), 'Hints'.padEnd(20), 'Raw Text'].join(' | '),
  );
  lines.push('─'.repeat(80));

  for (const n of flatNodes) {
    const span = `${n.from}-${n.to}`;
    const hints = (n.hints ?? []).join(', ');
    lines.push(
      [
        String(n.id).padEnd(6),
        n.type.padEnd(12),
        span.padEnd(12),
        (hints.length > 18 ? hints.slice(0, 15) + '...' : hints).padEnd(20),
        n.raw.replace(/\n/g, '\\n'),
      ].join(' | '),
    );
  }
  return lines.join('\n');
}

/**
 * Format ExecutionLog runtime output
 */
export function formatExecutionOutput(
  ir: WodWikiIRFile<ExecutionLog>,
  format: OutputFormat,
  pretty: boolean = true,
): string {
  if (format === 'json') {
    return JSON.stringify(ir, null, pretty ? 2 : undefined);
  }

  const { results, logs } = ir.data;
  const statements = logs;

  if (format === 'csv') {
    const header = 'id,outputType,started,ended,sourceBlockKey,stackLevel,completionReason,metrics,hints';
    const rows = statements.map((s) =>
      [
        s.id,
        s.outputType,
        s.timeSpan?.started ?? s.timestamp ?? 0,
        s.timeSpan?.ended ?? '',
        escapeCsvField(s.sourceBlockKey),
        s.stackLevel,
        escapeCsvField(s.completionReason ?? ''),
        escapeCsvField(s.metrics.map(formatMetric).join('; ')),
        escapeCsvField(s.hints?.join('; ') ?? ''),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  // format === 'table'
  const lines: string[] = [];
  lines.push(`Workout Execution Results:`);
  lines.push(`  Duration:  ${results.duration}ms`);
  lines.push(`  Completed: ${results.completed ? 'yes' : 'no'}`);
  lines.push(`  Start:     ${formatDate(results.startTime)}`);
  lines.push(`  End:       ${formatDate(results.endTime)}`);
  lines.push(`  Logs:      ${statements.length} statements emitted`);
  lines.push('─'.repeat(80));
  lines.push(
    ['ID'.padEnd(8), 'Type'.padEnd(12), 'Block'.padEnd(18), 'Reason'.padEnd(15), 'Metrics'].join(' | '),
  );
  lines.push('─'.repeat(80));

  for (const s of statements) {
    const metricsStr = s.metrics.map(formatMetric).join(', ');
    lines.push(
      [
        String(s.id).padEnd(8),
        (s.outputType ?? 'segment').padEnd(12),
        (s.sourceBlockKey ?? '-').padEnd(18),
        (s.completionReason ?? '-').padEnd(15),
        metricsStr,
      ].join(' | '),
    );
  }
  return lines.join('\n');
}

/**
 * Format QueryResult / RowsQueryResult / FindQueryResult / PipelineResult
 */
export function formatQueryOutput(
  ir: WodWikiIRFile<QueryResult | RowsQueryResult | FindQueryResult | PipelineResult>,
  format: OutputFormat,
  pretty: boolean = true,
): string {
  if (format === 'json') {
    return JSON.stringify(ir, null, pretty ? 2 : undefined);
  }

  const kind = ir.kind;

  if (kind === 'rows-result') {
    const data = ir.data as RowsQueryResult;
    if (format === 'csv') {
      const header = 'resultId,timestamp,outputType,eventId,metrics';
      const rows: string[] = [];
      for (const run of data.runs) {
        for (const event of run.events) {
          rows.push(
            [
              run.resultId,
              run.timestamp,
              event.outputType,
              event.id,
              escapeCsvField(event.metrics.map(formatMetric).join('; ')),
            ].join(','),
          );
        }
      }
      return [header, ...rows].join('\n');
    }

    // table
    const lines: string[] = [];
    lines.push(`Rows Query Result (${data.runs.length} runs):`);
    if (data.error) lines.push(`Error: ${data.error}`);
    lines.push('─'.repeat(80));
    lines.push(
      ['Result ID'.padEnd(20), 'Date'.padEnd(24), 'Events'].join(' | '),
    );
    lines.push('─'.repeat(80));
    for (const run of data.runs) {
      lines.push(
        [
          run.resultId.padEnd(20),
          formatDate(run.timestamp).padEnd(24),
          String(run.events.length),
        ].join(' | '),
      );
    }
    return lines.join('\n');
  }

  if (kind === 'find-result') {
    const data = ir.data as FindQueryResult;
    if (format === 'csv') {
      const header = 'target,id,title_or_label,sourceId';
      const rows: string[] = [];
      for (const n of data.notes) {
        rows.push(['note', n.id, escapeCsvField(n.title), escapeCsvField(n.sourceId ?? '')].join(','));
      }
      for (const b of data.blocks) {
        rows.push(['block', b.id, escapeCsvField(b.noteTitle), escapeCsvField(b.sourceId ?? '')].join(','));
      }
      for (const e of data.efforts ?? []) {
        rows.push(['effort', e.id, escapeCsvField(e.label), escapeCsvField(e.slug)].join(','));
      }
      return [header, ...rows].join('\n');
    }

    // table
    const lines: string[] = [];
    const matchedCount = data.stages?.matched ?? 0;
    const selectedCount = data.stages?.selected ?? 0;
    lines.push(`Find Result (matched: ${matchedCount} / selected: ${selectedCount}):`);
    lines.push('─'.repeat(80));
    lines.push(['Type'.padEnd(8), 'ID'.padEnd(24), 'Title / Label'.padEnd(30), 'Source ID'].join(' | '));
    lines.push('─'.repeat(80));
    for (const n of data.notes) {
      lines.push(['note'.padEnd(8), n.id.padEnd(24), n.title.padEnd(30), n.sourceId ?? '-'].join(' | '));
    }
    for (const b of data.blocks) {
      lines.push(['block'.padEnd(8), b.id.padEnd(24), b.noteTitle.padEnd(30), b.sourceId ?? '-'].join(' | '));
    }
    for (const e of data.efforts ?? []) {
      lines.push(['effort'.padEnd(8), e.id.padEnd(24), e.label.padEnd(30), e.slug].join(' | '));
    }
    return lines.join('\n');
  }

  if (kind === 'pipeline-result') {
    const data = ir.data as PipelineResult;
    const sink = data.chart ? `:${data.chart.head}` : 'data';
    if (format === 'csv') {
      const header = 'series,timestamp,date,value,unit';
      const rows: string[] = [];
      for (const s of data.series ?? []) {
        for (const pt of s.points) {
          rows.push(
            [
              escapeCsvField(s.label || s.key),
              pt.ts,
              formatDate(pt.ts),
              pt.value,
              escapeCsvField(s.unit ?? data.unit ?? ''),
            ].join(','),
          );
        }
      }
      return [header, ...rows].join('\n');
    }
    const lines: string[] = [];
    if (data.error) lines.push(`Pipeline Error: ${data.error}`);
    lines.push(`Pipeline Result (→ ${sink}):`);
    lines.push('─'.repeat(80));
    if (data.table) {
      lines.push(`Table: ${data.table.rows.length} of ${data.table.totalCount} rows`);
    }
    for (const s of data.series ?? []) {
      lines.push(`${s.label || s.key}: ${s.points.length} points${s.unit ? ` (${s.unit})` : ''}`);
    }
    if (data.notes?.length) lines.push(`notes: ${data.notes.length}`);
    if (data.blocks?.length) lines.push(`blocks: ${data.blocks.length}`);
    if (data.efforts?.length) lines.push(`efforts: ${data.efforts.length}`);
    if (data.runs?.length) lines.push(`runs: ${data.runs.length}`);
    return lines.join('\n');
  }

  // kind === 'query-result'
  const data = ir.data as QueryResult;
  if (data.scalar !== undefined && data.series.length === 0) {
    if (format === 'csv') {
      return `metric,scalar,unit\n${escapeCsvField(data.parsed.metric)},${data.scalar},${escapeCsvField(data.unit ?? '')}`;
    }
    return `Scalar Result: ${data.scalar}${data.unit ? ' ' + data.unit : ''}`;
  }

  if (format === 'csv') {
    const header = 'series,timestamp,date,value,unit';
    const rows: string[] = [];
    for (const s of data.series) {
      for (const pt of s.points) {
        rows.push(
          [
            escapeCsvField(s.label || s.key),
            pt.ts,
            formatDate(pt.ts),
            pt.value,
            escapeCsvField(s.unit ?? data.unit ?? ''),
          ].join(','),
        );
      }
    }
    return [header, ...rows].join('\n');
  }

  // table
  const lines: string[] = [];
  const matchedCount = (data.stages as { matched?: number; selected?: number } | undefined)?.matched ?? (data.stages as { selected?: number } | undefined)?.selected ?? data.matched?.length ?? 0;
  lines.push(`Query Result (${data.series.length} series, ${matchedCount} matched facts):`);
  lines.push(
    ['Series / Group'.padEnd(20), 'Timestamp'.padEnd(16), 'Date'.padEnd(24), 'Value'.padEnd(12), 'Unit'].join(' | '),
  );
  lines.push('─'.repeat(80));

  for (const s of data.series) {
    for (const pt of s.points) {
      lines.push(
        [
          (s.label || s.key).padEnd(20),
          String(pt.ts).padEnd(16),
          formatDate(pt.ts).padEnd(24),
          String(pt.value).padEnd(12),
          s.unit ?? data.unit ?? '-',
        ].join(' | '),
      );
    }
  }
  return lines.join('\n');
}
