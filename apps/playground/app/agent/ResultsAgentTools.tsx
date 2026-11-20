import React, { useEffect } from 'react';
import { useWebMCP } from '@mcp-b/react-webmcp';
import { getActiveResultsBridge, type ActiveResultsBridge } from '@/agent/surfaceBridges';
import { recordWebMcpToolInvocation, trackMountedWebMcpTool } from './toolLogStore';
import { waitForUiCommit } from './uiCommit';
import { uiResultsControlSchema } from './uiToolSpecs';

export const ResultsAgentTools: React.FC<{ results: ActiveResultsBridge }> = () => {
  useEffect(() => {
    return trackMountedWebMcpTool({
      name: 'ui_results_control',
      title: 'Control Session Results Workbench',
      description:
        'Switch tabs, toggle mobile grid/cards layout, open/close Source & History drawer, or open the Add-to-Dashboard sheet on `/results/:sessionId`.',
      tier: 1,
      scope: 'results-ui',
    });
  }, []);

  useWebMCP({
    name: 'ui_results_control',
    title: 'Control Session Results Workbench',
    description:
      'Control the mounted `/results/:sessionId` workbench (`activeTab`: splits|movement|compare|raw, `mobileViewMode`: grid|cards, `sourceDrawerOpen`, `openAddToDashboard`, `closeModals`).',
    inputSchema: uiResultsControlSchema,
    annotations: {
      title: 'Control Session Results Workbench',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(args) {
      const started = performance.now();
      try {
        const current = getActiveResultsBridge();
        if (!current) {
          throw new Error('No session results workbench is currently mounted.');
        }
        if (args.closeModals) {
          current.closeModals();
        }
        if (args.activeTab !== undefined) {
          current.setTab(args.activeTab);
        }
        if (args.mobileViewMode !== undefined) {
          current.setMobileViewMode(args.mobileViewMode);
        }
        if (args.sourceDrawerOpen !== undefined) {
          current.openSourceDrawer(args.sourceDrawerOpen);
        }
        if (args.openAddToDashboard) {
          current.openAddToDashboard();
        }
        await waitForUiCommit();
        const after = getActiveResultsBridge() ?? current;
        const res = {
          resultId: after.resultId,
          activeTab: after.activeTab,
          mobileViewMode: after.mobileViewMode,
          sourceDrawerOpen: after.sourceDrawerOpen,
          addToDashboardOpen: after.addToDashboardOpen,
        };
        recordWebMcpToolInvocation({
          toolName: 'ui_results_control',
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - started),
          ok: true,
          argsPreview: JSON.stringify(args).slice(0, 120),
        });
        return res;
      } catch (err) {
        recordWebMcpToolInvocation({
          toolName: 'ui_results_control',
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - started),
          ok: false,
          argsPreview: JSON.stringify(args).slice(0, 120),
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  });

  return null;
};
