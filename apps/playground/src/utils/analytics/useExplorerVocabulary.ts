import { useEffect, useState } from 'react';
import { queryService } from "@/services/queryService";

const KNOWN_METRIC_KEYS = ['totalVolume', 'tis', 'sessionLoad', 'totalReps', 'note'];
const KNOWN_TAG_KEYS = ['effort', 'discipline', 'intensity', 'tags', 'note', 'origin'];

export interface ExplorerVocabulary {
  metricKeys: string[];
  tagKeys: string[];
}

/** Vocabulary for the Explorer sidebar. Metric keys start from the canonical
 *  shipped set and are enriched by scanning the analytics store for the last
 *  year. Tag values are not enumerated yet (the store has no cheap tag-value
 *  index), so only tag keys are surfaced. */
export function useExplorerVocabulary(defer = false): ExplorerVocabulary {
  const [metricKeys, setMetricKeys] = useState<string[]>(KNOWN_METRIC_KEYS);

  useEffect(() => {
    if (defer) return;
    let cancelled = false;

    async function load() {
      try {
        const end = Date.now();
        const start = end - 365 * 24 * 60 * 60 * 1000;
        const facts = await queryService.getFactsByTimeRange(start, end);
        if (cancelled) return;
        const keys = new Set(
          [...KNOWN_METRIC_KEYS, ...facts.map((f) => f.metricKey)].filter((k): k is string => k !== undefined),
        );
        setMetricKeys(Array.from(keys).sort());
      } catch {
        // Leave the static vocabulary in place.
      }
    }

    const timer = setTimeout(() => {
      if (!cancelled) void load();
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [defer]);

  return { metricKeys, tagKeys: KNOWN_TAG_KEYS };
}
