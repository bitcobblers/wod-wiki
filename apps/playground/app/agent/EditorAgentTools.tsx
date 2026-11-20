import React, { useEffect } from 'react';
import { useWebMCP } from '@mcp-b/react-webmcp';
import { normalizeMarkdownOrBareScript } from '@bitcobblers/wod-wiki-engine/agent';
import { getActiveEditorBridge, type ActiveEditorBridge } from '@/agent/surfaceBridges';
import { getClockSnapshot } from '@/clock/clockCommands';
import { recordWebMcpToolInvocation, trackMountedWebMcpTool } from './toolLogStore';
import { waitForUiCommit } from './uiCommit';
import {
  uiEditorDraftSchema,
  uiEditorInspectorSchema,
  uiStartLiveWorkoutSchema,
} from './uiToolSpecs';

export const EditorAgentTools: React.FC<{ editor: ActiveEditorBridge }> = () => {
  useEffect(() => {
    const cleanDraft = trackMountedWebMcpTool({
      name: 'ui_editor_draft',
      title: 'Read, Edit, or Undo Live Note Editor Buffer',
      description: 'Inspect or modify the live CodeMirror 6 Note buffer.',
      tier: 1,
      scope: 'editor-ui',
    });
    const cleanStart = trackMountedWebMcpTool({
      name: 'ui_start_live_workout',
      title: 'Start Live Interactive Workout Timer',
      description: 'Start the live interactive workout clock from the active Note editor.',
      tier: 1,
      scope: 'editor-ui',
    });
    const cleanInspector = trackMountedWebMcpTool({
      name: 'ui_editor_inspector',
      title: 'Inspect or Control Whiteboard Token Inspector & Drawer',
      description: 'Inspect cursor-line tokens or control the Option A popover and Option B drawer.',
      tier: 1,
      scope: 'editor-ui',
    });
    return () => {
      cleanDraft();
      cleanStart();
      cleanInspector();
    };
  }, []);

  useWebMCP({
    name: 'ui_editor_draft',
    title: 'Read, Edit, or Undo Live Note Editor Buffer',
    description:
      'Inspect or modify the live CodeMirror 6 Note buffer (`read`, `replace`, `append`, `undo`) with full undo support and optional immediate save (`save: true`).',
    inputSchema: uiEditorDraftSchema,
    annotations: {
      title: 'Edit Live Note Draft',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async execute(args) {
      const started = performance.now();
      try {
        const current = getActiveEditorBridge();
        if (!current) throw new Error('No Note editor is currently mounted.');

        if (args.operation === 'read') {
          const content = current.getValue();
          return {
            operation: 'read' as const,
            noteId: current.noteId ?? null,
            readonly: current.readonly,
            sourceRevision: current.sourceRevision ?? null,
            content,
            workoutBlockIds: current.getBlocks().map((b) => b.id),
          };
        }

        if (args.operation === 'undo') {
          const undone = current.undoEdit();
          await waitForUiCommit();
          return {
            operation: 'undo' as const,
            undone,
            content: current.getValue(),
          };
        }

        if (!args.content) {
          throw new Error(`'content' is required when operation="${args.operation}".`);
        }

        const existing = current.getValue();
        const nextDoc =
          args.operation === 'replace'
            ? normalizeMarkdownOrBareScript(args.content)
            : `${existing.trimEnd()}\n\n${normalizeMarkdownOrBareScript(args.content)}`;

        await current.applyEdit(nextDoc, args.save === true);
        await waitForUiCommit();
        const updated = getActiveEditorBridge() ?? current;
        const res = {
          operation: args.operation,
          saved: args.save === true,
          noteId: updated.noteId ?? null,
          sourceRevision: updated.sourceRevision ?? null,
          workoutBlockIds: updated.getBlocks().map((b) => b.id),
          length: updated.getValue().length,
        };
        recordWebMcpToolInvocation({
          toolName: 'ui_editor_draft',
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - started),
          ok: true,
          argsPreview: JSON.stringify({ operation: args.operation, save: args.save }).slice(0, 120),
        });
        return res;
      } catch (err) {
        recordWebMcpToolInvocation({
          toolName: 'ui_editor_draft',
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - started),
          ok: false,
          argsPreview: JSON.stringify({ operation: args.operation }).slice(0, 120),
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  });

  useWebMCP({
    name: 'ui_start_live_workout',
    title: 'Start Live Interactive Workout Timer',
    description:
      'Launch the live interactive workout clock on screen from a workout block in the active Note editor so the human athlete and agent can co-drive the session via `ui_clock_control`.',
    inputSchema: uiStartLiveWorkoutSchema,
    annotations: {
      title: 'Start Live Workout Timer',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async execute(args) {
      const started = performance.now();
      try {
        const current = getActiveEditorBridge();
        if (!current) throw new Error('No Note editor is currently mounted.');
        const outcome = await current.startLiveWorkout(args.blockId, args.autoStart ?? true);
        if (!outcome.started) {
          throw new Error(outcome.error ?? 'Failed to start workout timer.');
        }
        // Wait briefly for FullscreenTimer & useClockController to mount and publish snapshot
        const deadline = Date.now() + 1500;
        while (!getClockSnapshot() && Date.now() < deadline) {
          await new Promise<void>((r) => setTimeout(r, 25));
        }
        await waitForUiCommit();
        const res = {
          started: true,
          blockId: outcome.blockId ?? null,
          clock: getClockSnapshot(),
        };
        recordWebMcpToolInvocation({
          toolName: 'ui_start_live_workout',
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - started),
          ok: true,
          argsPreview: JSON.stringify(args).slice(0, 120),
        });
        return res;
      } catch (err) {
        recordWebMcpToolInvocation({
          toolName: 'ui_start_live_workout',
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

  useWebMCP({
    name: 'ui_editor_inspector',
    title: 'Inspect or Control Whiteboard Token Inspector & Drawer',
    description:
      'Read parsed cursor-line tokens and inline lint fixes, open or close the Option A anchored token inspector popover, or toggle the Option B right inspector drawer (`Ctrl+Shift+I`).',
    inputSchema: uiEditorInspectorSchema,
    annotations: {
      title: 'Inspect or Control Token Inspector',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(args) {
      const started = performance.now();
      try {
        const current = getActiveEditorBridge();
        if (!current) throw new Error('No Note editor is currently mounted.');

        if (args.action === 'open_popover') {
          current.openTokenInspector?.({ mode: args.mode, tokenIndex: args.tokenIndex });
        } else if (args.action === 'close_popover') {
          current.closeTokenInspector?.();
        } else if (args.action === 'open_drawer') {
          current.setInspectorDrawer?.(true);
          if (args.mode || args.tokenIndex !== undefined) {
            current.openTokenInspector?.({ mode: args.mode, tokenIndex: args.tokenIndex });
          }
        } else if (args.action === 'close_drawer') {
          current.setInspectorDrawer?.(false);
        } else if (args.action === 'toggle_drawer') {
          const prev = current.getInspectorState?.()?.drawerOpen ?? false;
          current.setInspectorDrawer?.(!prev);
        }

        await waitForUiCommit();
        const state = current.getInspectorState?.() ?? null;
        const res = { ok: true, inspector: state };
        recordWebMcpToolInvocation({
          toolName: 'ui_editor_inspector',
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - started),
          ok: true,
          argsPreview: JSON.stringify(args).slice(0, 120),
        });
        return res;
      } catch (err) {
        recordWebMcpToolInvocation({
          toolName: 'ui_editor_inspector',
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
