import { test, expect } from '@playwright/test';

test.describe('PocketSRS Settings, Ergonomics & Guide Documentation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=PocketSRS v2.2');

    // Ensure sample deck is loaded
    const loadSampleBtn = page.locator('button:has-text("Load Sample Deck (Minna no Nihongo)")');
    if (await loadSampleBtn.isVisible()) {
      await loadSampleBtn.click();
    }

    // Wait until study is ready
    await page.waitForSelector('button:has-text("Study Book"):not([disabled])');
  });

  test('configures left-handed layout and mirrors bottom rating dock', async ({ page }) => {
    // 1. Open Settings Modal
    const settingsBtn = page.locator('button[title="Settings"]');
    await settingsBtn.click();
    await expect(page.locator('text=Preferences & Power Settings')).toBeVisible();

    // 2. Select Left-handed orientation
    const leftHandBtn = page.locator('button:has-text("Left")');
    await leftHandBtn.click();

    // 3. Save settings
    await page.locator('button:has-text("Save Preferences")').click();
    await expect(page.locator('text=Preferences & Power Settings')).not.toBeVisible();

    // 4. Start study session
    const studyBookBtn = page.locator('button:has-text("Study Book")').first();
    await studyBookBtn.click();

    // 5. Flip card to reveal rating buttons
    await page.locator('button:has-text("Show Answer")').click();

    // 6. Verify rating buttons container has RTL mirroring applied
    const ratingGrid = page.locator('div.grid.grid-cols-4');
    await expect(ratingGrid).toHaveClass(/\[direction:rtl\]/);
  });

  test('applies custom typography styles and font sizes to flashcard faces', async ({ page }) => {
    // 1. Open Settings Modal
    const settingsBtn = page.locator('button[title="Settings"]');
    await settingsBtn.click();
    await expect(page.locator('text=Preferences & Power Settings')).toBeVisible();

    // 2. Configure Traditional Serif / Mincho font
    const fontSelect = page.locator('select').first();
    await fontSelect.selectOption('serif');

    // 3. Configure Extra Large font sizing (XL)
    const xlBtn = page.locator('button:has-text("XL")');
    await xlBtn.click();

    // 4. Save settings
    await page.locator('button:has-text("Save Preferences")').click();
    await expect(page.locator('text=Preferences & Power Settings')).not.toBeVisible();

    // 5. Start study session
    const studyBookBtn = page.locator('button:has-text("Study Book")').first();
    await studyBookBtn.click();

    // 6. Flip card to ensure target character is revealed regardless of card direction (recognition vs production)
    const charDisplay = page.locator('.font-serif.text-7xl');
    if (!(await charDisplay.isVisible())) {
      await page.locator('button:has-text("Show Answer")').click();
    }
    await expect(charDisplay).toBeVisible();
  });

  test('opens Guide Modal and downloads all sample templates', async ({ page }) => {
    // 1. Open Guide via Top Navigation
    const guideBtn = page.locator('button[title*="Guide"]').first();
    await guideBtn.click();
    await expect(page.locator('text=PocketSRS Knowledge Base')).toBeVisible();

    // 2. Test CSV Template Download
    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button:has-text("CSV Template")').click(),
    ]);
    expect(csvDownload.suggestedFilename()).toBe('pocketsrs_template.csv');

    // 3. Test TSV Template Download
    const [tsvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button:has-text("TSV Template")').click(),
    ]);
    expect(tsvDownload.suggestedFilename()).toBe('pocketsrs_template.tsv');

    // 4. Test JSON Template Download
    const [jsonDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button:has-text("JSON Package")').click(),
    ]);
    expect(jsonDownload.suggestedFilename()).toBe('pocketsrs_deck_package.json');

    // 5. Test Markdown / Cloze Template Download
    const [mdDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button:has-text("Markdown Quick-Paste")').click(),
    ]);
    expect(mdDownload.suggestedFilename()).toBe('pocketsrs_quickpaste.md');

    // 6. Test Navigation across tabs
    await page.locator('button:has-text("FSRS-6 & Study Engine")').click();
    await expect(page.locator('text=Free Spaced Repetition Scheduler (FSRS-6)')).toBeVisible();

    await page.locator('button:has-text("Controls & Shortcuts")').click();
    await expect(page.locator('text=Keyboard Shortcuts Master Table')).toBeVisible();

    await page.locator('button:has-text("Offline PWA & Sync")').click();
    await expect(page.locator('text=Important: iOS Safari 7-Day Storage Eviction & PWA Installation')).toBeVisible();

    // 7. Close Guide Modal
    await page.keyboard.press('Escape');
    await expect(page.locator('text=PocketSRS Knowledge Base')).not.toBeVisible();
  });
});
