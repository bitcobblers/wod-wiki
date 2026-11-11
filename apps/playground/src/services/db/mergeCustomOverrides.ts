import { listScopedPropertyOverrides } from '@bitcobblers/wod-wiki-engine';
import type { OverridePropertyKind } from '@bitcobblers/wod-wiki-core';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';

export interface MergeableRegistryEntity {
  slug: string;
  registrySource: 'bundled' | 'user' | 'synthetic-unresolved';
  ownerNoteId?: string;
  sourceId?: string;
}

export async function mergeCustomOverridesIntoList<T extends MergeableRegistryEntity>(
  storage: IStorage,
  kind: OverridePropertyKind,
  base: readonly T[],
): Promise<T[]> {
  const overrides = await listScopedPropertyOverrides(storage, {
    notebookId: 'notebook/custom',
    kind,
  });
  if (overrides.length === 0) return [...base];
  const bySlug = new Map<string, T>();
  for (const item of base) {
    if (item.registrySource === 'user') bySlug.set(item.slug, item);
  }
  for (const ov of overrides) {
    if (ov.payload) {
      const entity = ov.payload as unknown as T;
      bySlug.set(ov.slug, {
        ...entity,
        slug: ov.slug,
        registrySource: 'user',
        ownerNoteId: ov.ownerNoteId,
        sourceId: 'notebook/custom',
      });
    }
  }
  return [
    ...base.filter((item) => item.registrySource !== 'user'),
    ...bySlug.values(),
  ];
}
