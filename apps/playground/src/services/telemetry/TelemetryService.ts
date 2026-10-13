/**
 * TelemetryService — the product-funnel seam (CONTEXT.md: service pattern).
 *
 * Records named events (e.g. the `home:*` funnel) to a dedicated
 * `wodwiki-telemetry` IndexedDB database — deliberately separate from the
 * workout fact store so funnel events never reach WQL queries or rollups.
 *
 * Local-always: `record()` persists regardless of consent. External
 * forwarding (gtag) happens only through the injected forwarder and is
 * enabled by default (opt-out via `setConsent(false)`). Consent persists in Storage.
 */
import { SimpleEventBus } from '@/services/events/SimpleEventBus';
import { remotePrefsMode, metaListRows, metaPutRow } from '@/services/storage/metaStore';

export interface TelemetryEvent {
  name: string;
  payload?: Record<string, unknown>;
  at: number;
}

export type TelemetryForwarder = (event: TelemetryEvent) => void;

export interface TelemetryServiceOptions {
  /** Consent persistence; defaults to globalThis.localStorage when present. */
  storage?: Storage;
  /** External sink (gtag wiring lives in the playground shell). */
  forwarder?: TelemetryForwarder;
  /** Injectable for tests; defaults to globalThis.indexedDB. */
  idb?: IDBFactory;
  /**
   * Server-mode persistence: one meta row ({ key, value }) per event.
   * When set, IndexedDB is never opened; consent stays browser-local.
   */
  sink?: (event: TelemetryEvent) => Promise<void>;
  /** Server-mode read-back for list(); required whenever sink is set. */
  load?: () => Promise<TelemetryEvent[]>;
}

const DB_NAME = 'wodwiki-telemetry';
const DB_VERSION = 1;
const STORE = 'events';
const CONSENT_KEY = 'wodwiki.telemetry.consent';

export class TelemetryService {
  readonly events = new SimpleEventBus<TelemetryEvent>();
  private consentListeners = new Set<(consent: boolean) => void>();
  private storage?: Storage;
  private forwarder?: TelemetryForwarder;
  private idb?: IDBFactory;
  private sink?: (event: TelemetryEvent) => Promise<void>;
  private load?: () => Promise<TelemetryEvent[]>;
  private dbPromise?: Promise<IDBDatabase | null>;
  private _consent: boolean;

  /** Wire/replace the external sink (playground shell injects gtag). */
  setForwarder(forwarder: TelemetryForwarder | undefined): void {
    this.forwarder = forwarder;
  }

  constructor(options: TelemetryServiceOptions = {}) {
    this.storage =
      options.storage ??
      (typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : undefined);
    this.forwarder = options.forwarder;
    this.idb = options.sink ? undefined : (options.idb ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined));
    this.sink = options.sink;
    this.load = options.load;
    // ponytail: opt-out default; add granular consent categories when privacy regulations require it.
    this._consent = this.storage?.getItem(CONSENT_KEY) !== 'denied';
  }

  get consent(): boolean {
    return this._consent;
  }

  setConsent(granted: boolean): void {
    if (this._consent === granted) return;
    this._consent = granted;
    try {
      this.storage?.setItem(CONSENT_KEY, granted ? 'granted' : 'denied');
    } catch {
      /* storage unavailable — consent stays session-local */
    }
    this.consentListeners.forEach((fn) => fn(granted));
  }

  subscribeConsent(fn: (consent: boolean) => void): () => void {
    this.consentListeners.add(fn);
    return () => this.consentListeners.delete(fn);
  }

  /** Local-always record; forwards unless consent is opted out. */
  record(name: string, payload?: Record<string, unknown>): void {
    const event: TelemetryEvent = { name, payload, at: Date.now() };
    // Persistence failure is logged, never an unhandled rejection and never
    // a fallback to a different store.
    void this.persist(event).catch((err) => console.error('[TelemetryService] persist failed:', err));
    this.events.emit(event);
    if (this._consent && this.forwarder) {
      try {
        this.forwarder(event);
      } catch (err) {
        console.error('[TelemetryService] forwarder error:', err);
      }
    }
  }

  /** Read back recorded events (debug views, tests) — the injected loader
   *  in server mode, the local IndexedDB store otherwise. */
  async list(): Promise<TelemetryEvent[]> {
    if (this.load) return this.load();
    const db = await this.open();
    if (!db) return [];
    const { promise, resolve, reject } = Promise.withResolvers<TelemetryEvent[]>();
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () =>
      resolve(
        (req.result as TelemetryEvent[]).map(({ name, payload, at }) => ({ name, payload, at })),
      );
    req.onerror = () => reject(req.error);
    return promise;
  }

  private async persist(event: TelemetryEvent): Promise<void> {
    if (this.sink) {
      await this.sink(event);
      return;
    }
    const db = await this.open();
    if (!db) return;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(event);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    return promise;
  }

  private open(): Promise<IDBDatabase | null> {
    if (!this.idb) return Promise.resolve(null);
    this.dbPromise ??= this.openDatabase();
    return this.dbPromise;
  }

  private async openDatabase(): Promise<IDBDatabase | null> {
    const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
    const req = this.idb!.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('by-name', 'name');
        store.createIndex('by-at', 'at');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    return promise.catch((err) => {
      console.error('[TelemetryService] open failed:', err);
      return null;
    });
  }
}
/** App-wide telemetry singleton. The forwarder is wired by the playground shell (lib/telemetry-gtag).
 *  Server mode persists each event as a `telemetry:*` meta row and reads
 *  them back through the same namespace; consent stays browser-local. */
export const telemetry = remotePrefsMode
  ? new TelemetryService({
      sink: (event) =>
        metaPutRow(`telemetry:${crypto.randomUUID()}`, { name: event.name, payload: event.payload, at: event.at }),
      load: async () => {
        const rows = await metaListRows<{ name: string; payload?: Record<string, unknown>; at: number }>('telemetry:');
        return rows.map((r) => r.value).sort((a, b) => a.at - b.at);
      },
    })
  : new TelemetryService();
