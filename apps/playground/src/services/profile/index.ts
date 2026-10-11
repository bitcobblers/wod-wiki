/**
 * ProfileService — the single local membership (identity + body metrics).
 *
 * Two adapters behind one interface: localStorage for the IndexedDB backend
 * (profile survives DB wipes that localStorage resets own separately), and
 * the `memberships` store through the shared `storage` singleton for the
 * remote backends — HTTP ApiStorage and the direct-browser Turso connection
 * (row id 'default', server-side).
 */

import type { Membership } from '@bitcobblers/wod-wiki-storage';
import { DEFAULT_MEMBERSHIP_ID, createDefaultMembership } from '@bitcobblers/wod-wiki-storage';
import type { IStorage } from '../storage/IStorage';
import { LocalStore } from '../storage/LocalStore';

export type MembershipPatch = Partial<Omit<Membership, 'id' | 'createdAt'>>;

export interface ProfileService {
  /** Bootstraps the default membership on first call. */
  current(): Promise<Membership>;
  /** Cached copy; undefined before the first current() resolves. When
   *  undefined, storage adapters skip user stamping (best-effort). */
  currentSync(): Membership | undefined;
  update(patch: MembershipPatch): Promise<Membership>;
}

const MEMBERSHIP_KEY = 'wodwiki.membership';
export function getProfileDisplayName(): string {
  try {
    const raw = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(MEMBERSHIP_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Membership> | null;
      if (typeof parsed?.displayName === 'string' && parsed.displayName.trim()) {
        return parsed.displayName.trim();
      }
    }
  } catch {
    // Non-fatal
  }
  return 'Anonymous';
}


export class LocalStorageProfileService implements ProfileService {
  private cache: Membership | undefined;
  /** Completion chain: concurrent patches (per-field onChange saves) must
   *  compose through the latest cache, never race last-write-wins. */
  private updates: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: LocalStore = new LocalStore()) {}

  currentSync(): Membership | undefined {
    // localStorage reads synchronously, so the profile is available before
    // the async bootstrap too.
    return this.cache ?? this.store.get<Membership>(MEMBERSHIP_KEY) ?? undefined;
  }

  async current(): Promise<Membership> {
    if (!this.cache) {
      this.cache = this.store.get<Membership>(MEMBERSHIP_KEY) ?? createDefaultMembership();
      this.store.set(MEMBERSHIP_KEY, this.cache);
    }
    return this.cache;
  }

  update(patch: MembershipPatch): Promise<Membership> {
    const next = this.updates.then(
      () => this.applyUpdate(patch),
      () => this.applyUpdate(patch),
    );
    this.updates = next.then(() => {}, () => {});
    return next;
  }

  private async applyUpdate(patch: MembershipPatch): Promise<Membership> {
    const merged: Membership = { ...(this.cache ?? this.store.get<Membership>(MEMBERSHIP_KEY) ?? createDefaultMembership()), ...patch, updatedAt: Date.now() };
    this.cache = merged;
    this.store.set(MEMBERSHIP_KEY, merged);
    return merged;
  }
}

// ponytail: `storage` resolves via dynamic import — storage/index.ts calls
// createProfileService at module eval, so a static import here would TDZ when
// this module evaluates first. Upgrade path: split the singleton into its own
// module and go back to a static import.
let storagePromise: Promise<IStorage> | undefined;
function sharedStorage(): Promise<IStorage> {
  return (storagePromise ??= import('../storage').then((m) => m.storage));
}

export class ApiProfileService implements ProfileService {
  private cache: Membership | undefined;
  /** Completion chain: concurrent patches (per-field onChange saves) must
   *  compose through the latest cache, never race last-write-wins. */
  private updates: Promise<unknown> = Promise.resolve();

  currentSync(): Membership | undefined {
    return this.cache;
  }

  async current(): Promise<Membership> {
    if (this.cache) return this.cache;
    const storage = await sharedStorage();
    let membership = await storage.readonly('memberships').get(DEFAULT_MEMBERSHIP_ID);
    if (!membership) {
      membership = createDefaultMembership();
      await storage.readwrite('memberships').put(membership);
    }
    this.cache = membership;
    return membership;
  }

  update(patch: MembershipPatch): Promise<Membership> {
    const next = this.updates.then(
      () => this.applyUpdate(patch),
      () => this.applyUpdate(patch),
    );
    this.updates = next.then(() => {}, () => {});
    return next;
  }

  private async applyUpdate(patch: MembershipPatch): Promise<Membership> {
    const merged: Membership = { ...(await this.current()), ...patch, updatedAt: Date.now() };
    const storage = await sharedStorage();
    await storage.readwrite('memberships').put(merged);
    this.cache = merged;
    return merged;
  }
}

export function createProfileService(backend: 'api' | 'indexed-db' | 'turso'): ProfileService {
  return backend === 'indexed-db' ? new LocalStorageProfileService() : new ApiProfileService();
}

/** Center-crops the image to a square, downscaled to at most max×max, as a
 *  JPEG data URL. No upscaling: small sources keep their original size. */
export function resizeImageToDataUrl(file: File, max = 256): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  if (!file.type.startsWith('image/')) {
    reject(new Error(`Not an image file: ${file.type || file.name || 'unknown'}`));
    return promise;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const srcSide = Math.min(img.naturalWidth, img.naturalHeight);
    const side = Math.min(max, srcSide);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas 2D context unavailable'));
      return;
    }
    ctx.drawImage(img, (img.naturalWidth - srcSide) / 2, (img.naturalHeight - srcSide) / 2, srcSide, srcSide, 0, 0, side, side);
    resolve(canvas.toDataURL('image/jpeg', 0.85));
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error(`Failed to decode image: ${file.name}`));
  };
  img.src = url;
  return promise;
}
