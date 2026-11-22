import React, { useEffect } from 'react';
import { useWebMCP } from '@mcp-b/react-webmcp';
import { normalizeMarkdownOrBareScript } from '@bitcobblers/wod-wiki-engine/agent';
import {
  getActiveEditorBridge,
  getActivePeekBridge,
  type ActiveEditorBridge,
  type PeekBridgeTarget,
} from '@/agent/surfaceBridges';
import { getClockSnapshot } from '@/clock/clockCommands';
import { recordWebMcpToolInvocation, trackMountedWebMcpTool } from './toolLogStore';
import { waitForUiCommit } from './uiCommit';
import {
  uiEditorDraftSchema,
  uiEditorInspectorSchema,
  uiPeekEntitySchema,
  uiStartLiveWorkoutSchema,
} from './uiToolSpecs';

function buildPeekTargetFromArgs(args: {
  kind?: 'effort' | 'equipment' | 'tag' | 'unrecognized' | 'note' | 'notebook' | 'day';
  slug?: string;
  label?: string;
  tagType?: string;
  term?: string;
  noteId?: string;
  title?: string;
  date?: string;
}): PeekBridgeTarget {
  switch (args.kind) {
    case 'effort':
      if (!args.slug?.trim()) throw new Error("'slug' is required when kind=\"effort\".");
      return {
        kind: 'effort',
        slug: args.slug.trim(),
        ...(args.label?.trim() ? { label: args.label.trim() } : {}),
      };
    case 'equipment':
      if (!args.slug?.trim()) throw new Error("'slug' is required when kind=\"equipment\".");
      return {
        kind: 'equipment',
        slug: args.slug.trim(),
        ...(args.label?.trim() ? { label: args.label.trim() } : {}),
      };
    case 'tag':
      if (!args.label?.trim()) throw new Error("'label' is required when kind=\"tag\".");
      return {
        kind: 'tag',
        label: args.label.trim().replace(/^#/, ''),
        ...(args.tagType?.trim() ? { tagType: args.tagType.trim() } : {}),
      };
    case 'unrecognized':
      if (!args.term?.trim()) throw new Error("'term' is required when kind=\"unrecognized\".");
      return { kind: 'unrecognized', term: args.term.trim() };
    case 'note':
      if (!args.noteId?.trim()) throw new Error("'noteId' is required when kind=\"note\".");
      return {
        kind: 'note',
        noteId: args.noteId.trim(),
        ...(args.title?.trim() ? { title: args.title.trim() } : {}),
      };
    case 'notebook':
      if (!args.slug?.trim()) throw new Error("'slug' is required when kind=\"notebook\".");
      return {
        kind: 'notebook',
        slug: args.slug.trim(),
        ...(args.title?.trim() ? { title: args.title.trim() } : {}),
      };
    case 'day':
      if (!args.date?.trim()) throw new Error("'date' is required when kind=\"day\".");
      return { kind: 'day', date: args.date.trim() };
    default:
      throw new Error("'kind' is required when action=\"open\".");
  }
}

export function usePeekEntityWebMcp(): void {
  useEffect(() => {
    return trackMountedWebMcpTool({
      name: 'ui_peek_entity',
      title: 'Inspect, Open, or Close Entity Peek Drawer',
      description: 'Inspect, open, or close the 340px right-edge Entity Peek Drawer on the live UI.',
      tier: 1,
      scope: 'editor-ui',
    });
  }, []);

  useWebMCP({
    name: 'ui_peek_entity',
    title: 'Inspect, Open, or Close Entity Peek Drawer',
    description:
      'Read active Entity Peek Drawer state (`status`), open a non-destructive 340px right-edge preview for an effort, equipment, tag, unrecognized term, note, notebook, or day (`open`), or dismiss the drawer (`close`). Mutually exclusive with the Whiteboard Token Inspector drawer.',
    inputSchema: uiPeekEntitySchema,
    annotations: {
      title: 'Inspect or Control Entity Peek Drawer',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(args) {
      const started = performance.now();
      try {
        const peekBridge = getActivePeekBridge();
        const editorBridge = getActiveEditorBridge();

        if (args.action === 'status') {
          const target = peekBridge?.getTarget() ?? null;
          const res = { ok: true, open: target !== null, target };
          recordWebMcpToolInvocation({
            toolName: 'ui_peek_entity',
            timestamp: Date.now(),
            durationMs: Math.round(performance.now() - started),
            ok: true,
            argsPreview: JSON.stringify(args).slice(0, 120),
          });
          return res;
        }

        if (args.action === 'close') {
          if (peekBridge) {
            peekBridge.closePeek();
          } else if (editorBridge?.closePeek) {
            editorBridge.closePeek();
          }
          await waitForUiCommit();
          const target = getActivePeekBridge()?.getTarget() ?? null;
          const res = { ok: true, open: target !== null, target };
          recordWebMcpToolInvocation({
            toolName: 'ui_peek_entity',
            timestamp: Date.now(),
            durationMs: Math.round(performance.now() - started),
            ok: true,
            argsPreview: JSON.stringify(args).slice(0, 120),
          });
          return res;
        }

        const nextTarget = buildPeekTargetFromArgs(args);
        if (peekBridge) {
          try {
            peekBridge.openPeek(nextTarget);
          } catch (err) {
            if (editorBridge?.peekEntity) {
              editorBridge.peekEntity(nextTarget);
            } else {
              throw err;
            }
          }
        } else if (editorBridge?.peekEntity) {
          editorBridge.peekEntity(nextTarget);
        } else {
          throw new Error('No Entity Peek surface is currently mounted.');
        }

        await waitForUiCommit();
        const resolvedTarget = getActivePeekBridge()?.getTarget() ?? nextTarget;
        const res = { ok: true, open: resolvedTarget !== null, target: resolvedTarget };
        recordWebMcpToolInvocation({
          toolName: 'ui_peek_entity',
          timestamp: Date.now(),
          durationMs: Math.round(performance.now() - started),
          ok: true,
          argsPreview: JSON.stringify(args).slice(0, 120),
        });
        return res;
      } catch (err) {
        recordWebMcpToolInvocation({
          toolName: 'ui_peek_entity',
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
}

export const PeekAgentTools: React.FC = () => {
  usePeekEntityWebMcp();
  return null;
};

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
      'Read parsed cursor-line tokens and inline lint fixes, open or close the Option A anchored token inspector popover (`Alt+.`), or toggle the Option B right inspector drawer (`Ctrl+Alt+I` / `Cmd+Alt+I`).',
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
