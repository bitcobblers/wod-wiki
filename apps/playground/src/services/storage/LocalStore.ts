/**
 * LocalStore — typed, injectable key-value store abstraction over localStorage.
 *
 * Provides JSON serialization, key qualification/prefixing, legacy alias fallback,
 * and safe error boundaries for private-browsing / quota-exceeded environments.
 * Test suites can inject an InMemoryBackend without touching window.localStorage globals.
 */

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class InMemoryBackend implements StorageBackend {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

export const browserLocalStorageBackend: StorageBackend = {
  getItem(key: string): string | null {
    try {
      return typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch {
      // Quota / private browsing exceptions are non-fatal
    }
  },
  removeItem(key: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch { /* silent — storage may be unavailable */ }
  },
};

export class LocalStore {
  constructor(
    readonly prefix: string = '',
    private readonly backend: StorageBackend = browserLocalStorageBackend,
  ) {}

  qualify(key: string): string {
    return this.prefix ? `${this.prefix}${key}` : key;
  }

  get<T>(key: string, options?: { alias?: string; fallback?: T }): T | null {
    const raw = this.getRaw(key, options?.alias);
    if (raw == null) return options?.fallback ?? null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return options?.fallback ?? null;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      this.backend.setItem(this.qualify(key), JSON.stringify(value));
    } catch { /* silent — backend may be read-only */ }
  }

  getRaw(key: string, alias?: string): string | null {
    let val = this.backend.getItem(this.qualify(key));
    if (val == null && alias) {
      val = this.backend.getItem(this.qualify(alias));
    }
    return val;
  }

  setRaw(key: string, value: string | null): void {
    if (value == null) {
      this.remove(key);
    } else {
      this.backend.setItem(this.qualify(key), value);
    }
  }

  remove(key: string, alias?: string): void {
    this.backend.removeItem(this.qualify(key));
    if (alias) {
      this.backend.removeItem(this.qualify(alias));
    }
  }
}
