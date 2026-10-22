import { beforeEach, describe, expect, it } from 'bun:test';
import { DATA_SETTINGS_KEY, getActiveLocalDbName, readDataSettings, selectLocalDatabase } from './dataSettings';

const TURSO = { kind: 'turso', url: 'libsql://backup.example.com', authToken: 'tok-123' };

beforeEach(() => {
  localStorage.removeItem(DATA_SETTINGS_KEY);
});

describe('selectLocalDatabase', () => {
  it('keeps a saved Turso target and only moves localDbName', () => {
    localStorage.setItem(DATA_SETTINGS_KEY, JSON.stringify({ ...TURSO }));
    selectLocalDatabase('restore-a1');

    const settings = readDataSettings();
    expect(settings.state).toBe('turso');
    if (settings.state !== 'turso') return;
    expect(settings.url).toBe(TURSO.url);
    expect(settings.authToken).toBe(TURSO.authToken);
    expect(settings.localDbName).toBe('restore-a1');
    expect(getActiveLocalDbName()).toBe('restore-a1');

    const persisted = JSON.parse(localStorage.getItem(DATA_SETTINGS_KEY)!);
    expect(persisted).toEqual({ kind: 'turso', url: TURSO.url, authToken: TURSO.authToken, localDbName: 'restore-a1' });
  });

  it('stays indexed-db when no backup target is configured', () => {
    selectLocalDatabase('restore-b2');

    const settings = readDataSettings();
    expect(settings.state).toBe('indexed-db');
    if (settings.state !== 'indexed-db') return;
    expect(settings.localDbName).toBe('restore-b2');
    expect(getActiveLocalDbName()).toBe('restore-b2');
  });

  it('rejects an invalid name and persists nothing', () => {
    localStorage.setItem(DATA_SETTINGS_KEY, JSON.stringify({ ...TURSO, localDbName: 'restore-a1' }));
    expect(() => selectLocalDatabase('bad name')).toThrow(/valid local database name/i);
    expect(() => selectLocalDatabase('')).toThrow(/valid local database name/i);

    const persisted = JSON.parse(localStorage.getItem(DATA_SETTINGS_KEY)!);
    expect(persisted.localDbName).toBe('restore-a1');
    expect(getActiveLocalDbName()).toBe('restore-a1');
  });
});
