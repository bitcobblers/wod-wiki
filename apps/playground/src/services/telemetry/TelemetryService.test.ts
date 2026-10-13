import { describe, expect, it, beforeEach } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { TelemetryService, type TelemetryEvent } from './TelemetryService';
import { HOME_EVENTS } from './homeEvents';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

describe('TelemetryService', () => {
  let service: TelemetryService;
  let forwarded: TelemetryEvent[];

  beforeEach(() => {
    forwarded = [];
    service = new TelemetryService({
      storage: memoryStorage(),
      idb: new IDBFactory(),
      forwarder: (e) => forwarded.push(e),
    });
  });

  it('persists every recorded event locally', async () => {
    service.record(HOME_EVENTS.demoRun, { source: 'hero' });
    const events = await service.list();
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('home:demo_run');
    expect(events[0].payload).toEqual({ source: 'hero' });
    expect(typeof events[0].at).toBe('number');
  });

  it('defaults to consent enabled (opt-out): records locally and forwards', () => {
    service.record(HOME_EVENTS.explorerOpened);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].name).toBe('home:explorer_opened');
  });

  it('revoking consent (opt-out) stops forwarding but keeps local recording', async () => {
    service.setConsent(false);
    service.record(HOME_EVENTS.lessonStarted);
    expect(forwarded).toHaveLength(0);
    expect(await service.list()).toHaveLength(1);
  });

  it('re-enabling consent resumes forwarding', () => {
    service.setConsent(false);
    service.record(HOME_EVENTS.demoEdited);
    expect(forwarded).toHaveLength(0);
    service.setConsent(true);
    service.record(HOME_EVENTS.demoEdited);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].name).toBe('home:demo_edited');
  });

  it('persists opt-out across instances via storage', () => {
    const storage = memoryStorage();
    const first = new TelemetryService({ storage });
    expect(first.consent).toBe(true);
    first.setConsent(false);
    const second = new TelemetryService({ storage });
    expect(second.consent).toBe(false);
  });

  it('emits recorded events on the bus', () => {
    const seen: TelemetryEvent[] = [];
    service.events.subscribe((e) => seen.push(e));
    service.record(HOME_EVENTS.noteCreated);
    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe('home:note_created');
  });

  it('notifies consent subscribers on change', () => {
    const seen: boolean[] = [];
    service.subscribeConsent((c) => seen.push(c));
    service.setConsent(false);
    service.setConsent(true);
    expect(seen).toEqual([false, true]);
  });

  it('exposes the 17 home funnel event names', () => {
    expect(Object.values(HOME_EVENTS)).toEqual([
      'home:demo_opened',
      'home:demo_run',
      'home:demo_edited',
      'home:library_opened',
      'home:feeds_opened',
      'home:note_created',
      'home:lesson_started',
      'home:cheatsheet_opened',
      'home:behaviors_opened',
      'home:analytics_guide_opened',
      'home:explorer_opened',
      'home:dashboard_viewed',
      'home:efforts_opened',
      'home:reference_opened',
      'home:chapter_hero_viewed',
      'home:chapter_example_run',
      'home:chapter_guide_clicked',
    ]);
  });
});
