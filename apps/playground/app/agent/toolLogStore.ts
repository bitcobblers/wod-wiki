import { useSyncExternalStore } from 'react';
import type { AgentRiskTier } from '@bitcobblers/wod-wiki-engine/agent';

export interface ActiveWebMcpToolEntry {
  name: string;
  title: string;
  description: string;
  tier: AgentRiskTier;
  scope: 'domain' | 'global-ui' | 'stream-ui' | 'explorer-ui' | 'editor-ui' | 'clock-ui';
}

export interface WebMcpToolLogItem {
  id: string;
  toolName: string;
  timestamp: number;
  durationMs: number;
  ok: boolean;
  argsPreview: string;
  error?: string;
}

interface ToolLogSnapshot {
  tools: ActiveWebMcpToolEntry[];
  logs: WebMcpToolLogItem[];
}

const activeTools = new Map<string, ActiveWebMcpToolEntry>();
let recentLogs: WebMcpToolLogItem[] = [];
let logSeq = 1;
let cachedSnapshot: ToolLogSnapshot = { tools: [], logs: [] };
const listeners = new Set<() => void>();

function recompute(): void {
  cachedSnapshot = {
    tools: [...activeTools.values()].sort((a, b) => a.name.localeCompare(b.name)),
    logs: recentLogs,
  };
  for (const listener of listeners) listener();
}

export function trackMountedWebMcpTool(entry: ActiveWebMcpToolEntry): () => void {
  activeTools.set(entry.name, entry);
  recompute();
  return () => {
    if (activeTools.get(entry.name) === entry) {
      activeTools.delete(entry.name);
      recompute();
    }
  };
}

export function recordWebMcpToolInvocation(item: Omit<WebMcpToolLogItem, 'id'>): void {
  const entry: WebMcpToolLogItem = {
    id: `call-${logSeq++}`,
    ...item,
  };
  recentLogs = [entry, ...recentLogs].slice(0, 40);
  recompute();
}

export function clearWebMcpToolLogs(): void {
  recentLogs = [];
  recompute();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ToolLogSnapshot {
  return cachedSnapshot;
}

export function useWebMcpInspectorState(): ToolLogSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
