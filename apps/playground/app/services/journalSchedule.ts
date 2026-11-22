import {
  attributeSession,
  batchScheduleNotes,
  findNearbyMatchingScheduleItems,
  getJournalDayOverlay,
  getNoteRevision,
  getScheduleAndSessionCountsByNote,
  listNoteRevisions,
  listScheduleItemsByDateRange,
  listScheduleItemsForNote,
  localCivilDateKey,
  migrateDatedPageNotesToSchedule,
  removeScheduleItem,
  scheduleNoteOnDate,
  updateScheduleItem,
  type AttributeSessionInput,
  type JournalDayOverlay,
  type NoteRevision,
  type NoteUsageCounts,
  type ScheduleItem,
  type ScheduleNoteOnDateInput,
  type ScheduleStatus,
} from '@bitcobblers/wod-wiki-engine';
import type { IStorage } from '@bitcobblers/wod-wiki-storage';
import type { Session } from '@/types/storage';
import { storageService } from '@/services/storage';

const SCHEDULE_MIGRATION_KEY = 'schedule:v35:pageNotesMigrated';
const migratedStorages = new WeakSet<IStorage>();
const scheduleListeners = new Set<() => void>();

export function notifyScheduleChanged(): void {
  for (const listener of [...scheduleListeners]) {
    try {
      listener();
    } catch {
      // Never let one subscriber stall schedule updates.
    }
  }
}

export function subscribeSchedule(listener: () => void): () => void {
  scheduleListeners.add(listener);
  return () => {
    scheduleListeners.delete(listener);
  };
}

export async function ensureScheduleMigrated(storage: IStorage = storageService.storage): Promise<void> {
  if (migratedStorages.has(storage)) return;
  try {
    const marker = await storage.readonly('meta').get(SCHEDULE_MIGRATION_KEY);
    if ((marker as { value?: unknown } | undefined)?.value === true) {
      migratedStorages.add(storage);
      return;
    }
    await migrateDatedPageNotesToSchedule(storage);
    await storage.readwrite('meta').put({ key: SCHEDULE_MIGRATION_KEY, value: true });
    migratedStorages.add(storage);
  } catch {
    // Minimal test mocks without meta/schedule_items stores stay non-blocking.
  }
}

export const journalSchedule = {
  async scheduleNote(input: ScheduleNoteOnDateInput): Promise<ScheduleItem> {
    await ensureScheduleMigrated();
    const created = await scheduleNoteOnDate(storageService.storage, input);
    notifyScheduleChanged();
    return created;
  },

  async batchSchedule(inputs: readonly ScheduleNoteOnDateInput[]): Promise<ScheduleItem[]> {
    await ensureScheduleMigrated();
    const created = await batchScheduleNotes(storageService.storage, inputs);
    notifyScheduleChanged();
    return created;
  },

  async updateItem(
    id: string,
    patch: { date?: string; status?: ScheduleStatus; slot?: string; position?: number; order?: number; notes?: string },
  ): Promise<ScheduleItem> {
    const { order, position, ...rest } = patch;
    const resolvedPosition = position ?? order;
    const updated = await updateScheduleItem(storageService.storage, id, {
      ...rest,
      ...(resolvedPosition !== undefined ? { position: resolvedPosition } : {}),
    });
    notifyScheduleChanged();
    return updated;
  },

  async removeItem(id: string): Promise<void> {
    await removeScheduleItem(storageService.storage, id);
    notifyScheduleChanged();
  },

  async listByDateRange(fromDate: string, toDate: string): Promise<ScheduleItem[]> {
    await ensureScheduleMigrated();
    return listScheduleItemsByDateRange(storageService.storage, fromDate, toDate);
  },

  async listAll(): Promise<ScheduleItem[]> {
    await ensureScheduleMigrated();
    try {
      return await storageService.storage.readonly('schedule_items').getAll();
    } catch {
      return [];
    }
  },

  async listForNote(noteId: string): Promise<ScheduleItem[]> {
    await ensureScheduleMigrated();
    return listScheduleItemsForNote(storageService.storage, noteId);
  },

  async getDayOverlay(date: string): Promise<JournalDayOverlay> {
    await ensureScheduleMigrated();
    return getJournalDayOverlay(storageService.storage, date);
  },

  async getUsageCountsByNote(): Promise<Map<string, NoteUsageCounts>> {
    await ensureScheduleMigrated();
    return getScheduleAndSessionCountsByNote(storageService.storage);
  },

  async attributeSession(input: AttributeSessionInput): Promise<Session> {
    const updated = await attributeSession(storageService.storage, input);
    notifyScheduleChanged();
    return updated;
  },

  async findNearbyMatches(session: Session, windowDays = 2): Promise<ScheduleItem[]> {
    await ensureScheduleMigrated();
    return findNearbyMatchingScheduleItems(storageService.storage, session, windowDays);
  },

  async getNoteRevision(noteId: string, version: number): Promise<NoteRevision | undefined> {
    return getNoteRevision(storageService.storage, noteId, version);
  },

  async listNoteRevisions(noteId: string): Promise<NoteRevision[]> {
    return listNoteRevisions(storageService.storage, noteId);
  },

  todayKey(instant = Date.now()): string {
    return localCivilDateKey(instant);
  },
};
