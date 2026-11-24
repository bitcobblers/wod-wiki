import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '@bitcobblers/wod-wiki-ui/primitives';
import { CreateNotebookDialog } from '@/components/organisms/notebook/CreateNotebookDialog';
import type { Notebook } from '@/types/notebook';
import { BackdateConfirmModal } from '../../../playground/app/components/organisms/journal/BackdateConfirmModal';
import {
  AgentConfirmHost,
  requestAgentConfirmation,
} from '../../../playground/app/agent/AgentConfirmHost';

function CreateNotebookHarness({
  mode,
  initialName,
  initialDescription,
}: {
  mode: 'create' | 'edit';
  initialName: string;
  initialDescription: string;
}) {
  const [open, setOpen] = useState(true);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const editNotebook: Notebook | null =
    mode === 'edit'
      ? {
          id: 'notebook/olympic-block',
          slug: 'olympic-block',
          notebookId: 'notebook/olympic-block',
          origin: 'user',
          name: initialName,
          description: initialDescription,
          icon: '🏋️',
          createdAt: 1790236800000,
        }
      : null;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={() => setOpen(true)}>
          {mode === 'edit' ? 'Re-open Edit Notebook' : 'Re-open Create Notebook'}
        </Button>
        {lastSaved && (
          <span data-testid="notebook-saved-result" className="text-xs font-mono text-success">
            Saved: {lastSaved}
          </span>
        )}
      </div>
      <CreateNotebookDialog
        open={open}
        onOpenChange={setOpen}
        notebook={editNotebook}
        onCreate={async (name, description, icon) => {
          setLastSaved(`${icon} ${name}${description ? ` — ${description}` : ''}`);
          const slug = name.toLowerCase().replace(/\s+/g, '-');
          return {
            id: `notebook/${slug}`,
            slug,
            notebookId: `notebook/${slug}`,
            origin: 'user',
            name,
            description,
            icon,
            createdAt: Date.now(),
          };
        }}
        onSave={async (nb, name, description, icon) => {
          setLastSaved(`Updated ${icon} ${name}`);
          return { ...nb, name, description, icon };
        }}
      />
    </div>
  );
}

function BackdateHarness({
  dateKey,
  isLoading,
}: {
  dateKey: string;
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState<'idle' | 'confirmed' | 'cancelled'>('idle');

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={() => { setStatus('idle'); setOpen(true); }}>
          Open Backdate Confirmation
        </Button>
        <span data-testid="backdate-status" className="text-xs font-mono text-muted-foreground">
          Status: {status}
        </span>
      </div>
      {open && (
        <BackdateConfirmModal
          dateKey={dateKey}
          isLoading={isLoading}
          onConfirm={async () => {
            setStatus('confirmed');
            setOpen(false);
          }}
          onCancel={() => {
            setStatus('cancelled');
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AgentConfirmHarness({
  action,
  summary,
  targetId,
  autoTrigger,
}: {
  action: string;
  summary: string;
  targetId: string;
  autoTrigger: boolean;
}) {
  const [decision, setDecision] = useState<'pending' | 'approved' | 'denied'>('pending');

  const trigger = () => {
    setDecision('pending');
    void requestAgentConfirmation({
      action,
      summary,
      targetId,
    }).then((approved) => {
      setDecision(approved ? 'approved' : 'denied');
    });
  };

  useEffect(() => {
    if (autoTrigger) trigger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTrigger, action, summary, targetId]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="destructive" onClick={trigger}>
          Trigger Agent Confirmation
        </Button>
        <span data-testid="agent-confirm-decision" className="text-xs font-mono text-muted-foreground">
          Decision: {decision}
        </span>
      </div>
      <AgentConfirmHost />
    </div>
  );
}

const meta: Meta = {
  title: 'Plan/Dialogs & Sheets/Playground Dialogs',
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
};

export default meta;

export const CreateNotebook: StoryObj<{
  mode: 'create' | 'edit';
  initialName: string;
  initialDescription: string;
}> = {
  args: {
    mode: 'create',
    initialName: 'Olympic Lifting Block',
    initialDescription: '12-week snatch and clean & jerk progression',
  },
  argTypes: {
    mode: { control: 'inline-radio', options: ['create', 'edit'] },
    initialName: { control: 'text' },
    initialDescription: { control: 'text' },
  },
  render: (args) => <CreateNotebookHarness {...args} />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole('dialog');
    const nameInput = await within(dialog).findByPlaceholderText(/Morning Routines/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Garage Conditioning');
    const submitBtn = within(dialog).getByRole('button', { name: /^(Create Notebook|Create|Save)$/i });
    await userEvent.click(submitBtn);
    await waitFor(async () => {
      await expect(within(canvasElement).getByTestId('notebook-saved-result')).toHaveTextContent(
        'Garage Conditioning',
      );
    });
  },
};

export const BackdateJournalEntry: StoryObj<{
  dateKey: string;
  isLoading: boolean;
}> = {
  args: {
    dateKey: '2026-10-14',
    isLoading: false,
  },
  argTypes: {
    dateKey: { control: 'text', description: 'ISO YYYY-MM-DD date key in the past' },
    isLoading: { control: 'boolean' },
  },
  render: (args) => <BackdateHarness {...args} />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText('Backdate Journal Entry')).toBeInTheDocument();
    const cancelBtn = body.getByRole('button', { name: 'Cancel' });
    await userEvent.click(cancelBtn);
    await waitFor(async () => {
      await expect(within(canvasElement).getByTestId('backdate-status')).toHaveTextContent(
        'Status: cancelled',
      );
    });
  },
};

export const AgentDestructiveConfirm: StoryObj<{
  action: string;
  summary: string;
  targetId: string;
  autoTrigger: boolean;
}> = {
  args: {
    action: 'delete_note',
    summary: 'Permanently delete note "Hero Murph" and its unreferenced local drafts.',
    targetId: 'note-hero-murph',
    autoTrigger: true,
  },
  argTypes: {
    action: { control: 'text' },
    summary: { control: 'text' },
    targetId: { control: 'text' },
    autoTrigger: { control: 'boolean' },
  },
  render: (args) => <AgentConfirmHarness {...args} />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText(/Hero Murph/i)).toBeInTheDocument();
    const cancelBtn = body.getByRole('button', { name: /Cancel|Deny/i });
    await userEvent.click(cancelBtn);
    await waitFor(async () => {
      await expect(within(canvasElement).getByTestId('agent-confirm-decision')).toHaveTextContent(
        'Decision: denied',
      );
    });
  },
};
