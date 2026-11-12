import React, { useEffect } from 'react';
import { useWebMCP } from '@mcp-b/react-webmcp';
import {
  dispatchClockCommand,
  getClockSnapshot,
  type ClockCommand,
  type ClockSnapshot,
} from '@/clock/clockCommands';
import { requestAgentConfirmation } from './AgentConfirmHost';
import { recordWebMcpToolInvocation, trackMountedWebMcpTool } from './toolLogStore';
import { waitForUiCommit } from './uiCommit';
import { uiClockControlSchema } from './uiToolSpecs';

export const LiveClockAgentTools: React.FC<{ clock: ClockSnapshot }> = () => {
  useEffect(() => {
    return trackMountedWebMcpTool({
      name: 'ui_clock_control',
      title: 'Control Live Workout Clock',
      description: 'Dispatch live clock commands to the active workout timer.',
      tier: 1,
      scope: 'clock-ui',
    });
  }, []);

  useWebMCP({
    name: 'ui_clock_control',
    title: 'Control Live Workout Clock',
    description:
      'Inspect or dispatch commands (`next`, `playback`, `ready-start`, `entry-save`, `entry-skip`, `reps-adjust`, `reps-set`, `choice-select`, `stop-request`, `stop-confirm`, `dismiss`) to the active on-screen workout clock.',
    inputSchema: uiClockControlSchema,
    annotations: {
      title: 'Control Live Workout Clock',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async execute(args, options) {
      const started = performance.now();
      try {
        const current = getClockSnapshot();
        if (!current) {
          throw new Error('No live workout clock is currently mounted.');
        }

        if (args.command === 'status') {
          return {
            accepted: true,
            snapshot: current,
          };
        }

        if (args.command === 'stop-confirm') {
          const approved = await requestAgentConfirmation(
            {
              action: 'ui_clock_control:stop-confirm',
              targetId: current.runId,
              summary: 'Stop and end the active live workout timer early',
            },
            options,
          );
          if (!approved) {
            throw new Error('User declined early termination of the active workout timer.');
          }
          // Ensure stopRequested gate is entered if not already requested
          if (!current.stopRequested) {
            dispatchClockCommand(current.runId, { kind: 'stop-request' });
            await waitForUiCommit();
          }
        }

        let cmd: ClockCommand;
        switch (args.command) {
          case 'entry-save': {
            const fieldId = args.fieldId ?? current.entry?.fieldId;
            if (!fieldId || typeof args.value !== 'number') {
              throw new Error('`entry-save` requires `value` (number) and an active or explicit `fieldId`.');
            }
            cmd = { kind: 'entry-save', fieldId, value: args.value };
            break;
          }
          case 'entry-skip': {
            const fieldId = args.fieldId ?? current.entry?.fieldId;
            if (!fieldId) throw new Error('`entry-skip` requires `fieldId`.');
            cmd = { kind: 'entry-skip', fieldId };
            break;
          }
          case 'reps-adjust': {
            const occurrenceId = args.occurrenceId ?? current.selectedOccurrenceId ?? current.reps[0]?.occurrenceId;
            if (!occurrenceId || (args.delta !== 1 && args.delta !== -1)) {
              throw new Error('`reps-adjust` requires `occurrenceId` and `delta` (+1 or -1).');
            }
            cmd = { kind: 'reps-adjust', occurrenceId, delta: args.delta };
            break;
          }
          case 'reps-set': {
            const occurrenceId = args.occurrenceId ?? current.selectedOccurrenceId ?? current.reps[0]?.occurrenceId;
            if (!occurrenceId || typeof args.value !== 'number') {
              throw new Error('`reps-set` requires `occurrenceId` and integer `value`.');
            }
            cmd = { kind: 'reps-set', occurrenceId, value: args.value };
            break;
          }
          case 'reps-select': {
            if (!args.occurrenceId) throw new Error('`reps-select` requires `occurrenceId`.');
            cmd = { kind: 'reps-select', occurrenceId: args.occurrenceId };
            break;
          }
          case 'choice-select': {
            const fieldId = args.fieldId ?? current.entry?.fieldId;
            if (!fieldId || typeof args.index !== 'number') {
              throw new Error('`choice-select` requires `fieldId` and `index`.');
            }
            cmd = { kind: 'choice-select', fieldId, index: args.index };
            break;
          }
          default:
            cmd = { kind: args.command };
            break;
        }

        const latestBefore = getClockSnapshot() ?? current;
        const accepted = dispatchClockCommand(latestBefore.runId, cmd);
        await waitForUiCommit();
        const res = {
          accepted,
          command: args.command,
          snapshot: getClockSnapshot(),
        };
        recordWebMcpToolInvocation({
          toolName: 'ui_clock_control',
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - started),
          ok: true,
          argsPreview: JSON.stringify(args).slice(0, 120),
        });
        return res;
      } catch (err) {
        recordWebMcpToolInvocation({
          toolName: 'ui_clock_control',
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
