/**
 * useEffortContent — Adapter over the deep `useRegistryPropertyNote` module
 * for Effort Property Notes (`/effort/:slug`).
 */

import { useCallback } from 'react';
import { effortToDocument, documentToEffort, type IEffort } from '@bitcobblers/wod-wiki-lang';
import { useEffortRegistry } from '../contexts/EffortRegistryContext';
import { useRegistryPropertyNote } from './usePropertyNote';

export interface UseEffortContentResult {
  document: string;
  setDocument: (value: string) => void;
  isLoading: boolean;
  effort: IEffort | null;
  isEditable: boolean;
  notFound: boolean;
  flush: () => Promise<void>;
  onLineChange: (line: number, column: number) => void;
  onBlur: () => void;
  save: (value?: string) => Promise<IEffort | null>;
  remove: () => Promise<void>;
  cloneForEdit: () => Promise<IEffort | null>;
  overrideInNotebook: (targetNotebookId: string, rawOverride?: string) => Promise<void>;
  error: string | null;
}

function fromEffortDocument(raw: string, base?: IEffort): { item: IEffort; errors: string[] } {
  const { effort, errors } = documentToEffort(raw, base);
  return { item: effort, errors };
}

function applyEffortCloneFields(cloned: IEffort, source: IEffort): IEffort {
  return {
    ...cloned,
    derivation: { parentSlug: source.slug, coefficients: {}, hardOverrides: {} },
  };
}

export function useEffortContent(slug: string | undefined): UseEffortContentResult {
  const { registry, isReady, revision, refresh } = useEffortRegistry();
  const resolveDirect = useCallback((s: string) => registry.resolve(s), [registry]);
  const resolveByAlias = useCallback((s: string) => registry.resolveByAlias(s), [registry]);

  const { item: effort, ...rest } = useRegistryPropertyNote<IEffort>({
    kind: 'effort',
    slug,
    isReady,
    revision,
    resolveDirect,
    resolveByAlias,
    toDocument: effortToDocument,
    fromDocument: fromEffortDocument,
    applyCloneFields: applyEffortCloneFields,
    refresh,
  });

  return {
    ...rest,
    effort,
  };
}
