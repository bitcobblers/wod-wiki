/**
 * Storage restore UI — desktop + mobile acceptance (live app).
 *
 * Covers the browser side of explicit isolated restore at /settings/storage:
 *   1. CLI pairing-file import (valid + invalid) fills the restore form.
 *   2. Canonical target probe surfaces lifecycle status (unreachable here —
 *      no Hrana server exists in this repo; compatible/incompatible remote
 *      replay semantics are proven at the sync.check.ts seam with real
 *      SQLite files).
 *   3. Credential-free safe export: unsent outbox edits + full local rows +
 *      content-source settings, no token/URL anywhere in the file.
 *   4. Restore refusals keep everything: same-URL target refused, settings
 *      untouched, original local database still readable afterwards.
 *   5. Mobile (375×812): the same section renders and refuses safely.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { seedNote, WOD_DB } from '../helpers/wodwikiDb';

const SETTINGS_URL = '/settings/storage';
const SETTINGS_KEY = 'wodwiki.dataSettings.v1';

const VALID_PAIRING = {
  wodWikiPairing: 1,
  kind: 'turso',
  url: 'libsql://pair-target.turso.io',
  authToken: 'pair-token-e2e',
  database: 'pair-target',
  schemaVersion: 32,
  createdAt: '2026-10-19T00:00:00.000Z',
};

async function gotoStorage(page: Page): Promise<void> {
  await page.goto(SETTINGS_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await expect(page.getByTestId('restore-section')).toBeVisible({ timeout: 15_000 });
}

/** Directly journal one pending edit group — the app is not connected to any
 *  target in this suite, so nothing drains it. */
async function seedOutboxEntry(page: Page): Promise<void> {
  await page.evaluate(async (dbName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['sync_outbox', 'attachments'], 'readwrite');
        const attachment = { id: 'e2e-binary', noteId: 'e2e-unsent', mimeType: 'application/octet-stream', label: 'Binary', data: new Uint8Array([0, 127, 255]).buffer, createdAt: 1 };
        tx.objectStore('attachments').put(attachment);
        tx.objectStore('sync_outbox').put({
          seq: 900_001,
          id: 'e2e-unsent-group',
          at: Date.now(),
          ops: [{ op: 'put', store: 'attachments', key: attachment.id, value: attachment }],
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, WOD_DB);
}

test.describe('Storage restore UI', () => {
  test.setTimeout(90_000);

  test('pairing import, unreachable probe, and safe export (desktop)', async ({ page }) => {
    await gotoStorage(page);

    // Invalid pairing file → presentable error, form untouched.
    await page.getByTestId('restore-pairing-input').setInputFiles({
      name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ not json'),
    });
    await expect(page.getByTestId('restore-pairing-error')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Backup database URL', exact: true })).toHaveValue('');

    // Valid pairing file → credentials land in the form (token never displayed).
    await page.getByTestId('restore-pairing-input').setInputFiles({
      name: 'pairing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(VALID_PAIRING)),
    });
    await expect(page.getByRole('textbox', { name: 'Backup database URL', exact: true })).toHaveValue(VALID_PAIRING.url);
    await expect(page.locator('#restore-token')).toHaveValue(VALID_PAIRING.authToken);

    // Probe a dead target → unreachable lifecycle, nothing saved.
    await page.getByRole('textbox', { name: 'Backup database URL', exact: true }).fill('libsql://127.0.0.1:9');
    await page.locator('#restore-token').fill('unreachable-token');
    await page.getByTestId('restore-check-button').click();
    await expect(page.getByTestId('restore-status-unreachable')).toBeVisible({ timeout: 15_000 });
    const savedRaw = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
    expect(savedRaw).toBeNull();

    // Safe export: outbox entry + full rows, credential-free.
    await seedOutboxEntry(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('restore-export-button').click(),
    ]);
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    expect(exported.format).toBe('wod-wiki-safe-export');
    expect(exported.pendingGroups.map((group: { id: string }) => group.id)).toContain('e2e-unsent-group');
    const attachment = exported.rows.find((entry: { store: string }) => entry.store === 'attachments').rows.find((row: { id: string }) => row.id === 'e2e-binary');
    expect(attachment.data).toEqual({ $binary: 'AH//', $bytes: 3 });
    expect(exported.pendingGroups.find((group: { id: string }) => group.id === 'e2e-unsent-group').ops[0].value.data).toEqual(attachment.data);
    expect(JSON.stringify(exported)).not.toContain('unreachable-token');
    expect(JSON.stringify(exported)).not.toContain('pair-token-e2e');
  });

  test('same-URL restore is refused and preserves settings plus local data (desktop)', async ({ page }) => {
    await gotoStorage(page);
    await seedNote(page, 'restore-keep', '```time\n10 Burpees\n```\n');
    const saved = { kind: 'turso', url: 'libsql://saved.turso.io', authToken: 'saved-token' };
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [SETTINGS_KEY, JSON.stringify(saved)] as const,
    );
    await gotoStorage(page);

    await page.getByRole('textbox', { name: 'Backup database URL', exact: true }).fill('libsql://saved.turso.io');
    await page.locator('#restore-token').fill('other-token');
    await page.getByTestId('restore-button').click();
    await page.getByTestId('restore-confirm-button').click();

    await expect(page.getByTestId('restore-error')).toContainText('already the active sync target');
    const after = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY));
    expect(after).toEqual(saved);
    const kept = await page.evaluate(async (dbName) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        return await new Promise<string | undefined>((resolve, reject) => {
          const tx = db.transaction('notes', 'readonly');
          const req = tx.objectStore('notes').get('restore-keep');
          req.onsuccess = () => resolve(req.result?.id);
          tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    }, WOD_DB);
    expect(kept).toBe('restore-keep');
  });

  test('restore section stays usable at mobile width (375×812)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoStorage(page);

    await page.getByTestId('restore-pairing-input').setInputFiles({
      name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('[]'),
    });
    await expect(page.getByTestId('restore-pairing-error')).toBeVisible();

    await page.getByRole('textbox', { name: 'Backup database URL', exact: true }).fill('libsql://saved.turso.io');
    await page.locator('#restore-token').fill('mobile-token');
    await page.getByTestId('restore-button').click();
    await page.getByTestId('restore-confirm-button').click();
    await expect(page.getByTestId('restore-error')).toBeVisible();
  });
});
