import { expect, test } from '@playwright/test';

/**
 * Sound Profiles (/settings/sound-profiles) — the settings surface for
 * user-defined sound profiles.
 *
 * A profile is a named set of rules. Each rule pairs a trigger point
 * (an offset relative to a block's own duration) with the sound played
 * there. A profile is selected by a tag: `sound-classic` on a note applies
 * it to the whole note, and `sound: #sound-classic` on a line applies it
 * to that block only.
 *
 * This covers the authoring loop the feature depends on: create a profile,
 * give it rules, see the selector tag, and delete it.
 */

test.describe('Sound Profiles — /settings/sound-profiles', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings/sound-profiles');
    // Start from a clean slate so a profile from a previous run cannot leak in.
    await page.evaluate(() => localStorage.removeItem('wodwiki.soundProfiles.v1profiles'));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sound Profiles' })).toBeVisible();
  });

  test('creates a profile and shows the tag that selects it', async ({ page }) => {
    await page.getByPlaceholder('New profile (e.g. Classic beeps)').fill('Classic');
    await page.getByRole('button', { name: /Add Profile/i }).click();

    await expect(page.getByText('Classic', { exact: true })).toBeVisible();
    // The selector tag is what a note or a line uses to pick this profile.
    await expect(page.getByRole('button', { name: 'Copy tag sound-classic' })).toBeVisible();
  });

  test('adds rules to a profile and rejects a malformed trigger', async ({ page }) => {
    await page.getByPlaceholder('New profile (e.g. Classic beeps)').fill('Classic');
    await page.getByRole('button', { name: /Add Profile/i }).click();
    await expect(page.getByText('Classic', { exact: true })).toBeVisible();

    // A trigger that is not a trigger is refused, and nothing is added.
    await page.getByLabel('New rule trigger').fill('nonsense');
    await page.getByRole('button', { name: /Add Rule/i }).click();
    await expect(page.getByText(/is not a trigger/)).toBeVisible();
    await expect(page.getByLabel('Trigger for rule 1')).toHaveCount(0);

    // A valid trigger adds the rule.
    await page.getByLabel('New rule trigger').fill('-:03');
    await page.getByLabel('New rule sound').selectOption('countdown-beep');
    await page.getByRole('button', { name: /Add Rule/i }).click();
    await expect(page.getByLabel('Trigger for rule 1')).toHaveValue('-:03');
  });

  test('keeps every rule when several are added', async ({ page }) => {
    await page.getByPlaceholder('New profile (e.g. Classic beeps)').fill('Classic');
    await page.getByRole('button', { name: /Add Profile/i }).click();
    await expect(page.getByText('Classic', { exact: true })).toBeVisible();

    for (const [trigger, sound] of [
      ['-:03', 'countdown-beep'],
      ['-:02', 'countdown-beep'],
      ['-:01', 'countdown-beep'],
    ] as const) {
      await page.getByLabel('New rule trigger').fill(trigger);
      await page.getByLabel('New rule sound').selectOption(sound);
      await page.getByRole('button', { name: /Add Rule/i }).click();
    }

    await expect(page.getByLabel('Trigger for rule 1')).toHaveValue('-:03');
    await expect(page.getByLabel('Trigger for rule 2')).toHaveValue('-:02');
    await expect(page.getByLabel('Trigger for rule 3')).toHaveValue('-:01');
  });

  test('deletes a profile after the confirm step', async ({ page }) => {
    await page.getByPlaceholder('New profile (e.g. Classic beeps)').fill('Classic');
    await page.getByRole('button', { name: /Add Profile/i }).click();
    await expect(page.getByText('Classic', { exact: true })).toBeVisible();

    await page.getByLabel('Delete profile Classic').click();
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText('Classic', { exact: true })).toHaveCount(0);
    await expect(page.getByText('No sound profiles created yet.')).toBeVisible();
  });
});
