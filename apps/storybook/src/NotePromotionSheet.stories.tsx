/**
 * Playground / Organisms / NotePromotionSheet — Notebook membership and
 * publication visibility over isolated domain states
 * (`parameters.domainState`). A stateful wrapper re-reads the live
 * `getNotePublicationSummary` + `getSessionsForNote` rows after every sheet
 * action, so `play()` scripts can assert each `Publication Visibility`
 * transition. The sheet portals into `document.body`, so `play()` scripts
 * query `within(canvasElement.ownerDocument.body)`.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import type { PublicationVisibilitySummary, Session } from '@bitcobblers/wod-wiki-core';
import type { DomainWorldInput } from '@bitcobblers/wod-wiki-core/testing';
import { getNotePublicationSummary } from '@bitcobblers/wod-wiki-engine';
import { NotePromotionSheet } from '@/components/organisms/notebook/NotePromotionSheet';
import { storage, storageService } from '@/hooks/useBrowserServices';
import { storyActions } from './testing/storyActions';

const NOTE_ID = 'note-clean-and-jerk-emom';
const SESSION_ID = 'sess-clean-and-jerk-emom';

const promotionWorld: DomainWorldInput = {
  propertyNotes: [
    {
      kind: 'effort',
      slug: 'clean-and-jerk',
      label: 'Clean & Jerk',
      aliases: ['clean and jerks'],
      baseAttributes: { met: 7.0, discipline: 'strength' },
    },
  ],
  notes: [
    {
      id: 'notebook/gym-wod',
      title: 'Gym WOD',
      rawContent: '---\ndescription: "Shared class programming"\n---\n\n# Gym WOD\n',
      notebookId: 'notebook/gym-wod',
      seedOrigin: 'user',
    },
    {
      id: NOTE_ID,
      title: 'Clean & Jerk EMOM',
      rawContent: '# Clean & Jerk EMOM\n\n```time\n(10) :60 EMOM\n  1 Clean & Jerk 155lb\n```\n',
      notebookIds: ['notebook/journal'],
    },
  ],
  sessions: [
    {
      id: SESSION_ID,
      noteId: NOTE_ID,
      startedAt: 1790323200000,
      durationMs: 600_000,
      origin: 'journal',
    },
  ],
};

/** Re-reads live summary + attached Sessions from the story's storage plane. */
function LivePromotionSheet({
  noteId,
  isReadOnlyFeedNote = false,
  onCloneRequest,
}: {
  noteId: string;
  isReadOnlyFeedNote?: boolean;
  onCloneRequest?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [summary, setSummary] = useState<PublicationVisibilitySummary | null>(null);
  const [noteSessions, setNoteSessions] = useState<readonly Session[]>([]);

  const reload = useCallback(async () => {
    setSummary(await getNotePublicationSummary(storage, noteId));
    setNoteSessions(await storageService.getSessionsForNote(noteId));
  }, [noteId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!summary) return null;

  return (
    <NotePromotionSheet
      open={open}
      onOpenChange={setOpen}
      noteId={noteId}
      storageInstance={storage}
      summary={summary}
      noteSessions={noteSessions}
      isReadOnlyFeedNote={isReadOnlyFeedNote}
      onRefresh={reload}
      onCloneRequest={onCloneRequest}
    />
  );
}

const visibilityHeader = (visibility: PublicationVisibilitySummary['visibility']) =>
  `${visibility} · Journal stays private`;

const meta: Meta<typeof NotePromotionSheet> = {
  title: 'Playground/Organisms/NotePromotionSheet',
  component: NotePromotionSheet,
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof NotePromotionSheet>;

export const PrivateJournalNote: Story = {
  parameters: { domainState: 'populatedJournal' },
  render: () => <LivePromotionSheet noteId="note-murph-memorial" />,
  play: async ({ canvasElement }) => {
    await storyActions.waitForHydrated(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const sheet = await body.findByTestId('publication-pill-popover');
    // Journal stays private; the recorded Murph session is not opted in
    await expect(within(sheet).getByText(visibilityHeader('Private'))).toBeVisible();
    await expect(within(sheet).getByText('0 of 1 shared')).toBeVisible();
    await expect(within(sheet).getByTestId('publication-session-toggle-sess-murph-2026-09-21')).not.toBeChecked();
  },
};

export const ReadOnlyFeedNoteClonePrompt: Story = {
  parameters: { domainState: 'readOnlyFeedNote' },
  render: () => {
    function ReadOnlyFeedStory() {
      const [cloneRequested, setCloneRequested] = useState(false);
      return (
        <>
          <LivePromotionSheet
            noteId="seed-note-helen"
            isReadOnlyFeedNote
            onCloneRequest={() => setCloneRequested(true)}
          />
          {cloneRequested && <div data-testid="promotion-clone-requested">Clone requested</div>}
        </>
      );
    }
    return <ReadOnlyFeedStory />;
  },
  play: async ({ canvasElement }) => {
    await storyActions.waitForHydrated(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const sheet = await body.findByTestId('publication-pill-popover');
    // Read-only upstream notice replaces membership controls entirely
    const cloneButton = await within(sheet).findByTestId('promotion-clone-readonly-btn');
    expect(within(sheet).queryByTestId('promotion-new-notebook-input')).toBeNull();
    await expect(
      within(sheet).getByText('No recorded Sessions yet. Sessions stay private unless opted in.'),
    ).toBeVisible();
    await userEvent.click(cloneButton);
    await waitFor(() => {
      expect(body.queryByTestId('publication-pill-popover')).toBeNull();
    });
    expect(within(canvasElement).getByTestId('promotion-clone-requested')).toBeVisible();
  },
};

export const PromoteToPublishedNoteWithData: Story = {
  parameters: { domainState: promotionWorld },
  render: () => <LivePromotionSheet noteId={NOTE_ID} />,
  play: async ({ canvasElement }) => {
    await storyActions.waitForHydrated(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const sheet = await body.findByTestId('publication-pill-popover');

    // 1. Start private: no Notebook membership, session not opted in
    await expect(within(sheet).getByText(visibilityHeader('Private'))).toBeVisible();
    const chip = await body.findByTestId('promotion-notebook-chip-notebook/gym-wod');
    await userEvent.click(within(chip).getByRole('button'));

    // Membership alone stays Private (the Notebook itself is still private)
    const publicToggle = await body.findByTestId('publication-notebook-public-toggle');
    await waitFor(() => expect(publicToggle).toBeEnabled());
    await waitFor(async () => {
      expect((await getNotePublicationSummary(storage, NOTE_ID)).visibility).toBe('Private');
    });

    // 2. Toggle the Notebook public → 'Published Note'
    await userEvent.click(publicToggle);
    await waitFor(() => {
      expect(within(sheet).getByText(visibilityHeader('Published Note'))).toBeVisible();
    });
    await waitFor(async () => {
      const live = await getNotePublicationSummary(storage, NOTE_ID);
      expect(live.visibility).toBe('Published Note');
      expect(live.notebookPublic).toBe(true);
    });

    // 3. Opt the recorded Session in → 'Published Note + Data'
    await waitFor(() => expect(body.getByTestId(`publication-session-toggle-${SESSION_ID}`)).toBeEnabled());
    await userEvent.click(body.getByTestId(`publication-session-toggle-${SESSION_ID}`));
    await waitFor(() => {
      expect(within(sheet).getByText(visibilityHeader('Published Note + Data'))).toBeVisible();
    });
    await waitFor(async () => {
      const live = await getNotePublicationSummary(storage, NOTE_ID);
      expect(live.visibility).toBe('Published Note + Data');
      expect(live.publicSessions).toBe(1);
    });
    await expect(body.getByTestId('publication-notebook-public-toggle')).toBeChecked();
    await expect(body.getByTestId(`publication-session-toggle-${SESSION_ID}`)).toBeChecked();
  },
};
