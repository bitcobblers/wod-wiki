/**
 * Actual rep capture for the live clock (clock-command-board).
 *
 * An actual is a user-origin Rep metric merged into the executing block's
 * `metric:result` memory. ReportOutputBehavior preserves it through pop and
 * segment emission carries it into the persisted EventRecord anchored by
 * `block.key.toString()` — a stable per-occurrence UUID (repeated rounds get
 * fresh child UUIDs, so round instances stay separate). Unknown ≠ zero:
 * reads return null until the user commits; an explicit 0 is a real count.
 */
import type { IMetric, IRuntimeBlock, IScriptRuntime } from '@bitcobblers/wod-wiki-engine';
import { MemoryLocation, MetricType } from '@bitcobblers/wod-wiki-engine';

/** Selects one movement inside a grouped (multi display-group) block. */
export interface ActualOccurrenceSelector {
  /** Statement id of the movement group, or its numeric group index. */
  sourceId?: number;
}

export interface ActualRepTarget {
  block: IRuntimeBlock;
  /** Stable occurrence identity: the block UUID, or `${uuid}:${sourceId}` per movement group. */
  occurrenceId: string;
  label: string;
  target: number | null;
}

function userRepMetrics(metrics: Iterable<IMetric>): IMetric[] {
  const hits: IMetric[] = [];
  for (const m of metrics) {
    if (m.origin === 'user' && m.type === MetricType.Rep && typeof m.value === 'number') {
      hits.push(m);
    }
  }
  return hits;
}

/**
 * Resolve the movement group index an occurrence selector points at.
 * Grouped blocks without a selector are ambiguous — commit throws rather
 * than broadcasting one count across every movement.
 */
function resolveGroupIndex(block: IRuntimeBlock, occurrence: ActualOccurrenceSelector | undefined, forWrite: boolean): number {
  const resultLocs = block.getMemoryByTag('metric:result');
  const displayLocs = block.getMemoryByTag('metric:display');
  const groupCount = Math.max(resultLocs.length, displayLocs.length);

  if (occurrence?.sourceId !== undefined) {
    const viaSourceId = block.sourceIds.indexOf(occurrence.sourceId);
    if (viaSourceId !== -1) return viaSourceId;
    if (Number.isInteger(occurrence.sourceId) && occurrence.sourceId >= 0 && occurrence.sourceId < groupCount) {
      return occurrence.sourceId;
    }
    if (forWrite) {
      throw new Error(`Block ${block.key.toString()} has no movement group for sourceId ${occurrence.sourceId}`);
    }
    return -1;
  }

  if (groupCount > 1) {
    if (forWrite) {
      throw new Error(
        `Grouped block ${block.key.toString()} has ${groupCount} movements — pass an occurrence sourceId instead of applying one count to every movement`,
      );
    }
    return -1;
  }
  return 0;
}

/**
 * Commit the user's actual rep count onto a live executing block. The write
 * lands in `metric:result` memory; ReportOutputBehavior keeps it through the
 * pop-time result rewrite, so the emitted segment (and the persisted
 * EventRecord) carries the user-origin value alongside the planned target.
 */
export function commitActualReps(block: IRuntimeBlock, count: number, occurrence?: ActualOccurrenceSelector): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(`Actual rep count must be a nonnegative safe integer, got ${count}`);
  }
  const idx = resolveGroupIndex(block, occurrence, true);
  const metric: IMetric = {
    type: MetricType.Rep,
    value: count,
    origin: 'user',
    image: String(count),
    sourceBlockKey: block.key.toString(),
    timestamp: new Date(),
  };

  const resultLocs = block.getMemoryByTag('metric:result');
  if (resultLocs.length === 0) {
    const displayLocs = block.getMemoryByTag('metric:display');
    if (displayLocs.length > 1) {
      // Grouped block: pre-create one result location per display group so
      // emission pairing (resultLocs[i] ↔ displayLocs[i], sourceIds[i]) holds
      // and the actual lands only on the targeted movement.
      for (let i = 0; i < displayLocs.length; i++) {
        block.pushMemory(new MemoryLocation('metric:result', i === idx ? [metric] : []));
      }
      return;
    }
    block.pushMemory(new MemoryLocation('metric:result', [metric]));
    return;
  }

  const loc = resultLocs[Math.min(idx, resultLocs.length - 1)];
  // Replace the prior user-origin rep only; every other metric stays.
  const kept = loc.metrics.filter((m) => !(m.origin === 'user' && m.type === MetricType.Rep));
  loc.update([...kept, metric]);
}

/**
 * Read the user's actual rep count from a block. Returns null while unknown
 * (no commit yet) — an explicit 0 is returned as 0, never collapsed to null.
 */
export function readActualReps(block: IRuntimeBlock, occurrence?: ActualOccurrenceSelector): number | null {
  const resultLocs = block.getMemoryByTag('metric:result');
  if (resultLocs.length === 0) return null;

  let idx = resolveGroupIndex(block, occurrence, false);
  if (idx === -1) return null;
  idx = Math.min(idx, resultLocs.length - 1);

  const hits = userRepMetrics(resultLocs[idx].metrics);
  const last = hits[hits.length - 1];
  return last ? (last.value as number) : null;
}

/**
 * Live rep occurrences for the clock command board: one entry per leaf
 * movement occurrence in stack order (repeated rounds appear as separate
 * entries — each round is a fresh child block with its own UUID). Pure
 * timers/rest (time-domain blocks), parent loops/containers and groups
 * without movement identity are excluded. Grouped movement blocks yield one
 * entry per movement group with composite occurrenceId
 * `${blockKey}:${sourceId}` so counts target an exact movement. Movements
 * without a planned rep count are listed with target null (unknown ≠ zero).
 */
const CONTAINER_BLOCK_TYPES = new Set(['Rounds', 'Group', 'AMRAP', 'EMOM', 'SessionRoot', 'Root']);
const TIME_DOMAIN_BLOCK_TYPES = new Set(['Timer']);

export function getActualRepTargets(runtime: IScriptRuntime): ActualRepTarget[] {
  const targets: ActualRepTarget[] = [];
  for (const block of runtime.stack.blocks) {
    // Parent loops/containers own children on the stack — never count them;
    // Timer covers pure timers and rest (time-domain, not rep-countable).
    const blockType = block.blockType ?? '';
    if (CONTAINER_BLOCK_TYPES.has(blockType) || TIME_DOMAIN_BLOCK_TYPES.has(blockType)) continue;
    if (block.getMemoryByTag('children:status').length > 0) continue;

    const displayLocs = block.getMemoryByTag('metric:display');
    const blockKey = block.key.toString();
    const grouped = displayLocs.length > 1;
    for (const loc of displayLocs) {
      const target = lastRepTarget(loc);
      const hasMovementIdentity = target !== null || loc.metrics.some((m) =>
        (m.type === MetricType.Effort || m.type === MetricType.Action)
        && (typeof m.value === 'string' || typeof m.image === 'string'));
      if (!hasMovementIdentity) continue;

      const idx = displayLocs.indexOf(loc);
      const sourceId = block.sourceIds[idx] ?? idx;
      targets.push({
        block,
        occurrenceId: grouped ? `${blockKey}:${sourceId}` : blockKey,
        label: movementLabel(block, loc),
        target,
      });
    }
  }
  return targets;
}

/** Planned rep value (last non-user rep metric with a numeric value), or null. */
function lastRepTarget(loc: { metrics: Iterable<IMetric> }): number | null {
  let target: number | null = null;
  for (const m of loc.metrics) {
    if (m.type === MetricType.Rep && m.origin !== 'user' && typeof m.value === 'number') {
      target = m.value;
    }
  }
  return target;
}

function movementLabel(block: IRuntimeBlock, loc: { metrics: Iterable<IMetric> }): string {
  if (block.getMemoryByTag('metric:display').length <= 1) return block.label;
  for (const m of loc.metrics) {
    if ((m.type === MetricType.Effort || m.type === MetricType.Action) && typeof m.value === 'string' && m.value) {
      return m.value;
    }
  }
  return block.label;
}

/**
 * Map an occurrenceId (plain block UUID or composite `${uuid}:${sourceId}`)
 * back to its block and optional occurrence selector. Returns undefined for
 * ids that no longer exist on the live stack (stale snapshot).
 */
export function findActualRepOccurrence(
  runtime: IScriptRuntime,
  occurrenceId: string,
): { block: IRuntimeBlock; occurrence: ActualOccurrenceSelector | undefined } | undefined {
  for (const block of runtime.stack.blocks) {
    const blockKey = block.key.toString();
    if (occurrenceId === blockKey) return { block, occurrence: undefined };
    if (occurrenceId.startsWith(`${blockKey}:`)) {
      const sourceId = Number(occurrenceId.slice(blockKey.length + 1));
      if (Number.isFinite(sourceId)) return { block, occurrence: { sourceId } };
    }
  }
  return undefined;
}
