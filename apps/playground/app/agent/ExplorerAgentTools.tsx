import React, { useEffect } from 'react';
import { useWebMCP } from '@mcp-b/react-webmcp';
import { getActiveExplorerBridge, type ActiveExplorerBridge } from '@/agent/surfaceBridges';
import { recordWebMcpToolInvocation, trackMountedWebMcpTool } from './toolLogStore';
import { waitForStreamSettle } from './uiCommit';
import { uiSetExplorerQuerySchema } from './uiToolSpecs';

export const ExplorerAgentTools: React.FC<{ explorer: ActiveExplorerBridge }> = () => {
  useEffect(() => {
    return trackMountedWebMcpTool({
      name: 'ui_set_explorer_query',
      title: 'Set or Run Analytics Explorer WQL Query',
      description: 'Update or run WQL queries, week windows, or dialogs on the Metric Explorer (/dashboards).',
      tier: 1,
      scope: 'explorer-ui',
    });
  }, []);

  useWebMCP({
    name: 'ui_set_explorer_query',
    title: 'Set or Run Analytics Explorer WQL Query',
    description:
      'Set or execute an aggregate or find WQL query on the Metric Explorer (`/dashboards`), change the week window (`4`, `8`, `16`), or open the Save-to-Dashboard / Query Settings dialogs.',
    inputSchema: uiSetExplorerQuerySchema,
    annotations: {
      title: 'Set Analytics Explorer Query',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(args) {
      const started = performance.now();
      try {
        const current = getActiveExplorerBridge();
        if (!current) {
          throw new Error('Metric Explorer (/dashboards) is not currently mounted.');
        }
        if (args.weeks !== undefined) {
          current.setWeeks(args.weeks);
        }
        if (args.query !== undefined) {
          current.setDraft(args.query);
          if (args.submit !== false) {
            current.submit(args.query);
          }
        } else if (args.submit === true) {
          current.submit();
        }
        if (args.openSaveDialog) {
          current.openSaveDialog();
        }
        if (args.openQuerySettings) {
          current.openQuerySettings();
        }
        await waitForStreamSettle();
        const after = getActiveExplorerBridge() ?? current;
        const res = {
          draft: after.draft,
          submitted: after.submitted,
          weeks: after.weeks,
          saveReady: after.saveReady,
          loading: after.loading,
        };
        recordWebMcpToolInvocation({
          toolName: 'ui_set_explorer_query',
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - started),
          ok: true,
          argsPreview: JSON.stringify(args).slice(0, 120),
        });
        return res;
      } catch (err) {
        recordWebMcpToolInvocation({
          toolName: 'ui_set_explorer_query',
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
