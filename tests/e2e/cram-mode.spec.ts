import { test, expect } from '@playwright/test';

test.describe('PocketSRS Non-Destructive Cram Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=PocketSRS v2.2');

    // Reset stores cleanly if decks exist
    await page.evaluate(async () => {
      const req = indexedDB.open('PocketSRSDatabase');
      await new Promise<void>((resolve) => {
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['cards', 'notes', 'decks', 'revlog'], 'readwrite');
          tx.objectStore('cards').clear();
          tx.objectStore('notes').clear();
          tx.objectStore('decks').clear();
          tx.objectStore('revlog').clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
        };
      });
    });

    await page.reload();
    await page.waitForSelector('text=PocketSRS v2.2');

    // Load fresh sample deck
    const loadSampleBtn = page.locator('button:has-text("Load Sample Deck (Minna no Nihongo)")');
    await expect(loadSampleBtn).toBeVisible();
    await loadSampleBtn.click();

    // Wait until all 10 new cards are reflected in UI badge
    await page.waitForSelector('span[title="New Cards"]:has-text("10")');
  });

  test('executes exam cramming without modifying scheduled due dates, stability, or creating revlog records', async ({ page }) => {
    // 1. Snapshot cards in IndexedDB prior to cramming
    const beforeCards = await page.evaluate(async () => {
      const req = indexedDB.open('PocketSRSDatabase');
      return new Promise<any[]>((resolve, reject) => {
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('cards', 'readonly');
          const store = tx.objectStore('cards');
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            db.close();
            resolve(getAll.result);
          };
          getAll.onerror = () => {
            db.close();
            reject(getAll.error);
          };
        };
      });
    });

    const beforeRevlogCount = await page.evaluate(async () => {
      const req = indexedDB.open('PocketSRSDatabase');
      return new Promise<number>((resolve, reject) => {
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('revlog', 'readonly');
          const store = tx.objectStore('revlog');
          const countReq = store.count();
          countReq.onsuccess = () => {
            db.close();
            resolve(countReq.result);
          };
          countReq.onerror = () => {
            db.close();
            reject(countReq.error);
          };
        };
      });
    });

    expect(beforeCards.length).toBe(10);
    expect(beforeRevlogCount).toBe(0);

    // 2. Expand Book to access Chapter 1 if needed
    const expandBtn = page.locator('button:has(svg.lucide-chevron-right)').first();
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForSelector('text=Chapter 1');
    }

    // 3. Launch Cram Mode on Chapter 1 (or root book)
    const cramBtn = page.locator('button[title*="Cram Mode"]').first();
    await expect(cramBtn).toBeVisible();
    await cramBtn.click();

    // 4. Verify Cram Mode Banner is active
    await expect(page.locator('text=Cram Mode (Non-Destructive)')).toBeVisible();

    // 5. Drill through multiple cards with different ratings
    for (let i = 0; i < 3; i++) {
      // Flip card
      await page.locator('button:has-text("Show Answer")').click();
      await expect(page.locator('button:has-text("Good")')).toBeVisible();

      // Rate card (cycle Again, Good, Easy)
      const rating = i === 0 ? 'Again' : i === 1 ? 'Good' : 'Easy';
      await page.locator(`button:has-text("${rating}")`).click();

      // Wait for next card front
      await page.waitForSelector('button:has-text("Show Answer")');
    }

    // 6. Exit Cram Mode back to Deck Tree
    const exitBtn = page.locator('button[title*="Exit Session"]').first();
    await exitBtn.click();
    await expect(page.locator('text=PocketSRS v2.2')).toBeVisible();

    // 7. Verify cards in IndexedDB remain pristine
    const afterCards = await page.evaluate(async () => {
      const req = indexedDB.open('PocketSRSDatabase');
      return new Promise<any[]>((resolve, reject) => {
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('cards', 'readonly');
          const store = tx.objectStore('cards');
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            db.close();
            resolve(getAll.result);
          };
          getAll.onerror = () => {
            db.close();
            reject(getAll.error);
          };
        };
      });
    });

    const afterRevlogCount = await page.evaluate(async () => {
      const req = indexedDB.open('PocketSRSDatabase');
      return new Promise<number>((resolve, reject) => {
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('revlog', 'readonly');
          const store = tx.objectStore('revlog');
          const countReq = store.count();
          countReq.onsuccess = () => {
            db.close();
            resolve(countReq.result);
          };
          countReq.onerror = () => {
            db.close();
            reject(countReq.error);
          };
        };
      });
    });

    // Revlog entries should not have increased
    expect(afterRevlogCount).toBe(0);

    // Card schedules must match initial snapshots exactly
    expect(afterCards.length).toBe(10);
    for (const beforeCard of beforeCards) {
      const afterCard = afterCards.find((c) => c.id === beforeCard.id);
      expect(afterCard).toBeDefined();
      expect(afterCard.due).toBe(beforeCard.due);
      expect(afterCard.stability).toBe(beforeCard.stability);
      expect(afterCard.difficulty).toBe(beforeCard.difficulty);
      expect(afterCard.reps).toBe(beforeCard.reps);
      expect(afterCard.lapses).toBe(beforeCard.lapses);
      expect(afterCard.state).toBe(beforeCard.state);
    }
  });
});
