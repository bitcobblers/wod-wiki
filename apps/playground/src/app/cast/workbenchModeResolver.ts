import type { DocumentItem } from '@/components/Editor/utils/documentStructure';
import type { ScriptBlock } from '@/components/Editor/types';
import type { Segment } from '@bitcobblers/wod-wiki-engine';
import type { ViewMode } from '@/panels/panel-system/ResponsiveViewport';
import type { UseRuntimeExecutionReturn } from '@bitcobblers/wod-wiki-engine/react';
import type { RpcWorkbenchUpdate } from '@/services/cast/rpc/RpcMessages';
import { buildPreviewProjection, buildReviewProjection } from './workbenchProjection';

export interface WorkbenchModeResolverState {
  readonly viewMode: ViewMode;
  readonly executionStatus: UseRuntimeExecutionReturn['status'];
  readonly runtime: unknown | null;
  readonly analyticsSegments: Segment[];
  readonly selectedBlock: ScriptBlock | null;
  readonly documentItems: DocumentItem[];
}

/**
 * Single mapping point from workbench state to receiver display update.
 */
export class WorkbenchModeResolver {
  resolve(state: WorkbenchModeResolverState): RpcWorkbenchUpdate {
    const mode = this.resolveMode(state);

    if (mode === 'active') {
      return { type: 'rpc-workbench-update', mode: 'active' };
    }

    if (mode === 'review') {
      return buildReviewProjection(state.analyticsSegments);
    }

    return buildPreviewProjection(state.selectedBlock, state.documentItems);
  }

  private resolveMode(state: WorkbenchModeResolverState): 'active' | 'review' | 'preview' {
    if (state.viewMode === 'track') {
      if (state.runtime && (state.executionStatus === 'running' || state.executionStatus === 'paused')) {
        return 'active';
      }

      if (state.analyticsSegments.length > 0) {
        return 'review';
      }

      if (state.runtime) {
        return 'active';
      }

      return 'preview';
    }

    if (state.viewMode === 'review' && state.analyticsSegments.length > 0) {
      return 'review';
    }

    return 'preview';
  }
}

export const workbenchModeResolver = new WorkbenchModeResolver();
