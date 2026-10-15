/**
 * extractEffortSlugs — port of wod-wiki's
 * apps/playground/src/services/storage/StorageService.ts (the pure function
 * only). Derives canonical effort slugs referenced by script statements for
 * the block-efforts containment index.
 */
import type { ICodeStatement } from '@bitcobblers/wod-wiki-core';

export function extractEffortSlugs(statements: ICodeStatement[]): string[] {
  const slugs = new Set<string>();
  for (const statement of statements) {
    if (statement.exerciseId) {
      slugs.add(statement.exerciseId);
    } else {
      const effortMetric = statement.metrics?.getMetric?.('effort');
      const effort = effortMetric && typeof effortMetric.value === 'string' ? effortMetric.value : undefined;
      if (effort) {
        const slug = effort.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (slug) slugs.add(slug);
      }
    }
  }
  return Array.from(slugs);
}
