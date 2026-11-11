import { formatTimeMMSS, type Segment } from '@bitcobblers/wod-wiki-engine';
import type { DocumentItem } from '@/components/Editor/utils/documentStructure';
import type { ScriptBlock } from '@/components/Editor/types';
import type { RpcWorkbenchUpdate } from '@/services/cast/rpc/RpcMessages';

export function buildReviewProjection(
  analyticsSegments: Segment[],
): RpcWorkbenchUpdate {
  const totalSeconds = analyticsSegments.length > 0
    ? Math.max(...analyticsSegments.map((segment) => segment.endTime))
      - Math.min(...analyticsSegments.map((segment) => segment.startTime))
    : 0;
  const totalMs = Math.round(totalSeconds * 1000);

  const rows: Array<{ label: string; value: string }> = [];
  if (totalMs > 0) {
    rows.push({ label: 'Total Time', value: formatTimeMMSS(totalMs) });
  }
  rows.push({ label: 'Segments', value: String(analyticsSegments.length) });

  if (analyticsSegments.length > 0) {
    const maxDepth = Math.max(...analyticsSegments.map((segment) => segment.depth));
    analyticsSegments
      .filter((segment) => segment.depth === maxDepth)
      .slice(0, 4)
      .forEach((segment) => {
        rows.push({
          label: segment.name || 'Segment',
          value: formatTimeMMSS(Math.round(segment.elapsed * 1000)),
        });
      });
  }

  return {
    type: 'rpc-workbench-update',
    mode: 'review',
    reviewData: {
      totalDurationMs: totalMs,
      completedSegments: analyticsSegments.length,
      rows,
    },
  };
}

export function buildCompletedRuntimeProjection(options: {
  readonly totalDurationMs: number;
  readonly segmentCount: number;
}): RpcWorkbenchUpdate {
  return {
    type: 'rpc-workbench-update',
    mode: 'review',
    reviewData: {
      totalDurationMs: options.totalDurationMs,
      completedSegments: options.segmentCount,
      rows: [
        { label: 'Total Time', value: formatTimeMMSS(options.totalDurationMs) },
        { label: 'Segments', value: String(options.segmentCount) },
      ],
    },
  };
}

export function buildPreviewProjection(
  selectedBlock: ScriptBlock | null,
  documentItems: DocumentItem[],
): RpcWorkbenchUpdate {
  const workoutItems = documentItems.filter((item) => item.type === 'time' || item.type === 'log');

  if (workoutItems.length === 0 && !selectedBlock) {
    return { type: 'rpc-workbench-update', mode: 'idle' };
  }

  const titleSource = selectedBlock?.content ?? workoutItems[0]?.content ?? '';
  const title = titleSource.split('\n')[0].trim().substring(0, 60) || 'Workout';

  const blocks = workoutItems.slice(0, 8).map((item) => ({
    id: item.id,
    title: (item.scriptBlock?.content ?? item.content).split('\n')[0].trim().substring(0, 50) || 'Workout',
    statementCount: item.scriptBlock?.statements?.length ?? 0,
  }));

  return {
    type: 'rpc-workbench-update',
    mode: 'preview',
    previewData: { title, blocks },
  };
}
