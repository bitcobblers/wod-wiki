import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TEST_IDS } from '@/lib/testIds';
import type { Entry } from '../../lib/entryMapper';
import type { ViewSettings } from '../../lib/viewSettingsStorage';
import { LibraryRow } from '../library/LibraryRow';
import { CalendarAgendaView } from './CalendarAgendaView';
import { CalendarPlannerView } from './CalendarPlannerView';
import { StreamViewPopover } from './StreamViewPopover';

afterEach(cleanup);

function makeDatedEntry(id: string, date: string, title: string): Entry {
  return {
    id,
    kind: 'note',
    sourceNotebook: 'journal',
    sourceNote: id,
    title,
    date,
    editable: true,
  };
}

describe('WW-131: StreamViewPopover human layout label & URL sync', () => {
  it('renders human-readable URL-resolved layout instead of cryptic AGD badge', () => {
    const settings: ViewSettings = {
      level: 'note',
      layout: 'agenda',
      visibleFields: ['title', 'date'],
    };
    render(
      <StreamViewPopover
        level="note"
        settings={settings}
        layout="rows"
        availableLayouts={['cards', 'rows', 'agenda', 'planner']}
        availableGroupDims={[]}
        groupDims={[]}
        onLayoutChange={vi.fn()}
        onToggleGroupDim={vi.fn()}
        onToggleField={vi.fn()}
      />,
    );

    const trigger = screen.getByTestId(TEST_IDS.STREAM_VIEW_POPOVER_TRIGGER);
    expect(trigger.textContent).toContain('Rows');
    expect(trigger.textContent).not.toContain('AGD');
    expect(trigger.textContent).not.toContain('ROW');

    fireEvent.click(trigger);
    const rowsBtn = screen.getByRole('button', { name: 'Rows' });
    const agendaBtn = screen.getByRole('button', { name: 'Agenda' });
    expect(rowsBtn.getAttribute('aria-pressed')).toBe('true');
    expect(agendaBtn.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('WW-132: LibraryRow Publish / Export pending guard', () => {
  it('disables the button with aria-busy and Exporting… label while publishing', () => {
    const localFeed: Entry = {
      id: 'feed-local',
      kind: 'feed',
      sourceNotebook: 'feeds',
      sourceNote: 'local',
      feedId: 'local',
      title: 'My Published Feed',
      date: '',
    };
    const onPublish = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <LibraryRow entry={localFeed} onPublishFeed={onPublish} publishing={false} />
      </MemoryRouter>,
    );

    const btn = screen.getByTestId(TEST_IDS.LIBRARY_PUBLISH_LOCAL_FEED) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-busy')).toBe('false');
    expect(btn.textContent).toContain('Publish / Export');

    rerender(
      <MemoryRouter>
        <LibraryRow entry={localFeed} onPublishFeed={onPublish} publishing={true} />
      </MemoryRouter>,
    );
    const busyBtn = screen.getByTestId(TEST_IDS.LIBRARY_PUBLISH_LOCAL_FEED) as HTMLButtonElement;
    expect(busyBtn.disabled).toBe(true);
    expect(busyBtn.getAttribute('aria-busy')).toBe('true');
    expect(busyBtn.textContent).toContain('Exporting…');
  });
});

describe('WW-150: Calendar month picker & Jump to nearest populated month CTA', () => {
  it('offers one-click Jump to August 2099 in CalendarAgendaView and reveals far-future note', () => {
    const entries = [makeDatedEntry('future-1', '2099-08-02', 'Far Future PR Session')];
    const onMonthChange = vi.fn();

    render(
      <MemoryRouter>
        <CalendarAgendaView
          entries={entries}
          stickyOffset={0}
          monthParam="2026-11"
          onMonthChange={onMonthChange}
        />
      </MemoryRouter>,
    );

    const jumpBtn = screen.getByTestId(TEST_IDS.CALENDAR_JUMP_POPULATED_MONTH);
    expect(jumpBtn.textContent).toContain('Jump to August 2099');

    fireEvent.click(jumpBtn);
    expect(onMonthChange).toHaveBeenCalledWith('2099-08');

    const picker = screen.getByTestId(TEST_IDS.CALENDAR_MONTH_PICKER) as HTMLInputElement;
    expect(picker.value).toBe('2026-11');
    fireEvent.change(picker, { target: { value: '2099-08' } });
    expect(onMonthChange).toHaveBeenLastCalledWith('2099-08');
  });

  it('offers Jump to August 2099 banner in CalendarPlannerView when active month is empty', () => {
    const entries = [makeDatedEntry('future-1', '2099-08-02', 'Far Future PR Session')];
    const onMonthChange = vi.fn();

    render(
      <MemoryRouter>
        <CalendarPlannerView
          entries={entries}
          monthParam="2026-11"
          onMonthChange={onMonthChange}
        />
      </MemoryRouter>,
    );

    const jumpBtn = screen.getByTestId(TEST_IDS.CALENDAR_JUMP_POPULATED_MONTH);
    expect(jumpBtn.textContent).toContain('Jump to August 2099');
    fireEvent.click(jumpBtn);
    expect(onMonthChange).toHaveBeenCalledWith('2099-08');
  });
});
