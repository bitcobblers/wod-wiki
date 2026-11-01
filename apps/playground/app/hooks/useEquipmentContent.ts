/**
 * useEquipmentContent — Adapter over the deep `useRegistryPropertyNote` module
 * for Equipment Property Notes (`/equipment/:slug`).
 */

import { useCallback, useEffect, useState } from 'react';
import { equipmentToDocument, documentToEquipment, type IEffort, type IEquipment } from '@bitcobblers/wod-wiki-lang';
import { useEquipmentRegistry } from '../contexts/EquipmentRegistryContext';
import { useEffortRegistry } from '../contexts/EffortRegistryContext';
import { storageService } from '@/services/storage';
import { useRegistryPropertyNote } from './usePropertyNote';

/** Minimal editable starter document for the create page (`/equipment/new?mode=create`). */
export function blankEquipmentDocument(slug: string, label?: string): string {
  const title = label
    ?? slug
      .replace(/[-_]+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return equipmentToDocument({
    id: `equipment-user-${crypto.randomUUID()}`,
    slug,
    label: title || slug,
    aliases: [],
    registrySource: 'user',
  });
}

export interface UseEquipmentContentResult {
  document: string;
  setDocument: (value: string) => void;
  isLoading: boolean;
  equipment: IEquipment | null;
  isEditable: boolean;
  notFound: boolean;
  flush: () => Promise<void>;
  onLineChange: (line: number, column: number) => void;
  onBlur: () => void;
  save: (value?: string) => Promise<IEquipment | null>;
  remove: () => Promise<void>;
  cloneForEdit: () => Promise<IEquipment | null>;
  error: string | null;
  isAliasMatch: boolean;
}

function fromEquipmentDocument(raw: string, base?: IEquipment): { item: IEquipment; errors: string[] } {
  const { equipment, errors } = documentToEquipment(raw, base);
  return { item: equipment, errors };
}

export function useEquipmentContent(slug: string | undefined): UseEquipmentContentResult {
  const { registry, isReady, refresh } = useEquipmentRegistry();
  const resolveDirect = useCallback((s: string) => registry.resolve(s), [registry]);
  const resolveByAlias = useCallback((s: string) => registry.resolveByAlias(s), [registry]);

  const { item: equipment, ...rest } = useRegistryPropertyNote<IEquipment>({
    kind: 'equipment',
    slug,
    isReady,
    resolveDirect,
    resolveByAlias,
    toDocument: equipmentToDocument,
    fromDocument: fromEquipmentDocument,
    refresh,
  });

  return {
    ...rest,
    equipment,
  };
}

export interface EquipmentLinksResult {
  /** Effort definitions that reference this equipment (canonical slug list). */
  efforts: IEffort[];
  /** Notes whose workout blocks link this equipment, with real titles. */
  usedBy: Array<{ noteId: string; title: string }>;
}

/**
 * Context data for the equipment detail page: related effort definitions
 * (canonical `equipment` references) and real usage (block_equipment links).
 */
export function useEquipmentLinks(slug: string | undefined): EquipmentLinksResult {
  const { isReady, registry } = useEquipmentRegistry();
  const { isReady: effortsReady, revision: effortRevision, registry: effortRegistry } = useEffortRegistry();
  const [links, setLinks] = useState<EquipmentLinksResult>({ efforts: [], usedBy: [] });

  useEffect(() => {
    if (!isReady || !effortsReady || !slug) {
      setLinks({ efforts: [], usedBy: [] });
      return;
    }
    let cancelled = false;
    async function load() {
      const efforts = effortRegistry.list().filter((effort) => effort.equipment?.includes(slug!) ?? false);
      const usedBy = await storageService.getEquipmentUsage(slug!);
      if (!cancelled) setLinks({ efforts, usedBy });
    }
    load();
    return () => { cancelled = true; };
  }, [slug, isReady, effortsReady, effortRevision, registry, effortRegistry]);

  return links;
}
