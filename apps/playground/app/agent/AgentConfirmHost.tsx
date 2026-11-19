import React, { useSyncExternalStore } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AgentConfirmationRequest } from '@bitcobblers/wod-wiki-engine/agent';
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogFooter,
  DialogHeader,
} from '@bitcobblers/wod-wiki-ui/primitives';

interface PendingConfirmation {
  id: number;
  request: AgentConfirmationRequest;
  resolve: (approved: boolean) => void;
}

let activeConfirm: PendingConfirmation | null = null;
let confirmSeq = 1;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function promptModal(request: AgentConfirmationRequest): Promise<boolean> {
  if (activeConfirm) {
    activeConfirm.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const id = confirmSeq++;
    activeConfirm = {
      id,
      request,
      resolve: (approved: boolean) => {
        if (activeConfirm?.id === id) {
          activeConfirm = null;
          notify();
        }
        resolve(approved);
      },
    };
    notify();
  });
}

export interface WebMcpInteractionClientLike {
  requestUserInteraction?: <T>(cb: () => Promise<T>) => Promise<T>;
}

export interface WebMcpExecuteOptionsLike {
  signal?: AbortSignal;
  client?: WebMcpInteractionClientLike;
  requestUserInteraction?: <T>(cb: () => Promise<T>) => Promise<T>;
}

export async function requestAgentConfirmation(
  request: AgentConfirmationRequest,
  executeOptions?: unknown,
): Promise<boolean> {
  const opts =
    executeOptions && typeof executeOptions === 'object'
      ? (executeOptions as WebMcpExecuteOptionsLike)
      : undefined;
  const interactionFn = opts?.client?.requestUserInteraction ?? opts?.requestUserInteraction;
  if (typeof interactionFn === 'function') {
    return interactionFn(() => promptModal(request));
  }
  return promptModal(request);
}

export const AgentConfirmHost: React.FC = () => {
  const pending = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => activeConfirm,
    () => null,
  );

  if (!pending) return null;

  return (
    <div data-agent-hidden="">
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) pending.resolve(false);
        }}
      >
        <AlertDialogBackdrop />
        <AlertDialogContent data-testid="agent-confirm-dialog">
          <DialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
              Confirm Agent Action
            </AlertDialogTitle>
            <AlertDialogDescription>
              An AI agent requested a destructive operation (<strong>{pending.request.action}</strong>).
            </AlertDialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-1">
            <div className="font-medium text-foreground">{pending.request.summary}</div>
            <div className="font-mono text-muted-foreground">
              Target: <span data-testid="agent-confirm-target">{pending.request.targetId}</span>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <AlertDialogClose
              data-testid="agent-confirm-cancel"
              onClick={() => pending.resolve(false)}
            >
              Deny
            </AlertDialogClose>
            <AlertDialogClose
              value="confirm"
              data-variant="destructive"
              data-testid="agent-confirm-approve"
              onClick={() => pending.resolve(true)}
            >
              Approve Action
            </AlertDialogClose>
          </DialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
