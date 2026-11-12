import React, { useEffect } from 'react';
import { useWebMCP } from '@mcp-b/react-webmcp';
import { getActiveStreamBridge, type ActiveStreamBridge } from '@/agent/surfaceBridges';
import { recordWebMcpToolInvocation, trackMountedWebMcpTool } from './toolLogStore';
import { waitForStreamSettle } from './uiCommit';
import { uiSetStreamQuerySchema } from './uiToolSpecs';

export const StreamAgentTools: React.FC<{ stream: ActiveStreamBridge }> = () => {
  useEffect(() => {
    return trackMountedWebMcpTool({
      name: 'ui_set_stream_query',
      title: 'Set Live Stream WQL Query or Layout',
      description: 'Update live WQL query, layout, or grouping on the mounted stream view.',
      tier: 1,
      scope: 'stream-ui',
    });
  }, []);

  useWebMCP({
    name: 'ui_set_stream_query',
    title: 'Set Live Stream WQL Query or Layout',
    description:
      'Update the live WQL query, layout (`cards`, `rows`, `feed`, `agenda`, `planner`), or grouping on the currently mounted stream view, or pass `resetToDefault: true` to restore the route default query.',
    inputSchema: uiSetStreamQuerySchema,
    annotations: {
      title: 'Set Live Stream Query',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(args) {
      const started = performance.now();
      try {
        const current = getActiveStreamBridge();
        if (!current) {
          throw new Error('No stream view is currently mounted.');
        }
        if (args.resetToDefault) {
          current.setQuery(current.defaultQuery);
        } else if (args.query !== undefined) {
          current.setQuery(args.query);
        }
        if (args.layout !== undefined) {
          current.setLayout(args.layout);
        }
        if (args.groupBy !== undefined) {
          current.setGroupBy(args.groupBy === null ? undefined : args.groupBy);
        }
        await waitForStreamSettle();
        const after = getActiveStreamBridge() ?? current;
        const viewStateRaw = document.getElementById('agent-view-state')?.textContent;
        const parsedState = viewStateRaw ? (JSON.parse(viewStateRaw) as { stream?: { totalUnbatchedCount?: number | null } }) : null;
        const res = {
          route: after.route,
          query: after.query,
          layout: after.layout,
          groupBy: after.groupBy ?? null,
          totalUnbatchedCount: parsedState?.stream?.totalUnbatchedCount ?? null,
        };
        recordWebMcpToolInvocation({
          toolName: 'ui_set_stream_query',
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - started),
          ok: true,
          argsPreview: JSON.stringify(args).slice(0, 120),
        });
        return res;
      } catch (err) {
        recordWebMcpToolInvocation({
          toolName: 'ui_set_stream_query',
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
