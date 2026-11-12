import React, { useSyncExternalStore } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AgentConfirmationRequest } from '@bitcobblers/wod-wiki-engine/agent';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/atoms/primitives/dialog';
import { Button } from '@/components/atoms/primitives/button';

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

/**
 * Tier 2 destructive confirmation gate for WebMCP tools.
 * Uses `client.requestUserInteraction(...)` when supplied by a WebMCP host,
 * rendering a Radix confirmation modal so an agent can never silently delete
 * user data or terminate an active workout session without human approval.
 */
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) pending.resolve(false);
      }}
    >
      <DialogContent data-testid="agent-confirm-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
            Confirm Agent Action
          </DialogTitle>
          <DialogDescription>
            An AI agent requested a destructive operation (<strong>{pending.request.action}</strong>).
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-1">
          <div className="font-medium text-foreground">{pending.request.summary}</div>
          <div className="font-mono text-muted-foreground">
            Target: <span data-testid="agent-confirm-target">{pending.request.targetId}</span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            data-testid="agent-confirm-cancel"
            onClick={() => pending.resolve(false)}
          >
            Deny
          </Button>
          <Button
            type="button"
            variant="destructive"
            data-testid="agent-confirm-approve"
            onClick={() => pending.resolve(true)}
          >
            Approve Action
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
