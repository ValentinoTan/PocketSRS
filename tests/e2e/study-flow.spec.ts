import { test, expect } from '@playwright/test';

test.describe('PocketSRS Study Flow & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('text=PocketSRS v2.2');

    // Ensure sample deck is loaded if empty state is present
    const loadSampleBtn = page.locator('button:has-text("Load Sample Deck (Minna no Nihongo)")');
    if (await loadSampleBtn.isVisible()) {
      await loadSampleBtn.click();
    }

    // Wait until study is ready
    await page.waitForSelector('button:has-text("Study Book"):not([disabled])');
  });

  test('completes full study workflow with keyboard hotkeys, Quick-Edit, flags, and undo', async ({ page }) => {
    // 1. Launch study from root book
    const studyBookBtn = page.locator('button:has-text("Study Book")').first();
    await expect(studyBookBtn).toBeVisible();
    await studyBookBtn.click();

    // 2. Verify Study Canvas loads
    await expect(page.locator('text=Minna no Nihongo')).toBeVisible();
    const showAnswerBtn = page.locator('button:has-text("Show Answer")');
    await expect(showAnswerBtn).toBeVisible();

    // 3. Test Flip via Spacebar
    await page.keyboard.press('Space');
    await expect(showAnswerBtn).not.toBeVisible();
    await expect(page.locator('button:has-text("Good")')).toBeVisible();

    // 4. Test 1-Tap Color Flag (Hotkey: F)
    await page.keyboard.press('f');
    await expect(page.locator('text=Flagged RED')).toBeVisible();

    // 5. Test Quick-Edit Modal (Hotkey: E)
    await page.keyboard.press('e');
    await expect(page.locator('text=Quick Edit Note')).toBeVisible();
    // Close Quick Edit with Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Quick Edit Note')).not.toBeVisible();

    // 6. Test Rating via Number Key (3 = Good)
    await page.keyboard.press('3');
    // Advances to next card: Show Answer button reappears
    await expect(page.locator('button:has-text("Show Answer")')).toBeVisible();

    // 7. Test Instant Undo (Hotkey: Z)
    await page.keyboard.press('z');
    await expect(page.locator('text=Undone previous review')).toBeVisible();
  });

  test('handles mobile gesture swipes for Again (left) and Good (right)', async ({ page }) => {
    // Launch study session
    const studyBookBtn = page.locator('button:has-text("Study Book")').first();
    await expect(studyBookBtn).toBeVisible();
    await studyBookBtn.click();

    // Flip card first
    await page.locator('button:has-text("Show Answer")').click();
    await expect(page.locator('button:has-text("Again")')).toBeVisible();

    // Helper to simulate swipe across Chromium, Firefox and WebKit
    const simulateSwipe = async (startX: number, startY: number, endX: number, endY: number) => {
      await page.evaluate(({ sX, sY, eX, eY }) => {
        const container = document.querySelector('.cursor-pointer') as HTMLElement;
        if (!container) return;

        const emit = (type: string, x: number, y: number) => {
          let evt: any;
          try {
            const t = new Touch({ identifier: Date.now(), target: container, clientX: x, clientY: y });
            evt = new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], bubbles: true });
          } catch {
            evt = new CustomEvent(type, { bubbles: true });
            Object.defineProperty(evt, 'touches', {
              value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }],
            });
          }
          container.dispatchEvent(evt);
        };

        emit('touchstart', sX, sY);
        emit('touchmove', eX, eY);
        emit('touchend', eX, eY);
      }, { sX: startX, sY: startY, eX: endX, eY: endY });
    };

    // Simulate Left Swipe (dx = -100 < -60) -> Triggers Again (1)
    await simulateSwipe(200, 200, 100, 200);

    // Card advances and front is shown again
    await expect(page.locator('button:has-text("Show Answer")')).toBeVisible();

    // Flip next card
    await page.locator('button:has-text("Show Answer")').click();
    await expect(page.locator('button:has-text("Good")')).toBeVisible();

    // Simulate Right Swipe (dx = +100 > 60) -> Triggers Good (3)
    await simulateSwipe(100, 200, 200, 200);

    // Card advances
    await expect(page.locator('button:has-text("Show Answer")')).toBeVisible();
  });

  test('validates Type-in-the-Answer mode diff rendering', async ({ page }) => {
    // Launch study session
    const studyBookBtn = page.locator('button:has-text("Study Book")').first();
    await expect(studyBookBtn).toBeVisible();
    await studyBookBtn.click();

    // Enable Type Mode
    const typeModeBtn = page.locator('button:has-text("Type Mode")');
    await expect(typeModeBtn).toBeVisible();
    await typeModeBtn.click();

    // Input field appears
    const input = page.locator('input[placeholder="Type reading or answer..."]');
    await expect(input).toBeVisible();

    // Type a test answer and submit with Enter
    await input.fill('test');
    await input.press('Enter');

    // Verify Diff comparison is rendered
    await expect(page.locator('text=Typed Answer Comparison:')).toBeVisible();
    await expect(page.locator('text=Expected:')).toBeVisible();
    await expect(page.locator('text=You typed:')).toBeVisible();
  });

  test('handles multi-character ghost guide and pill selector in ScratchpadCanvas', async ({ page }) => {
    // 1. Seed a custom multi-character note to ensure immediate multi-char card
    await page.evaluate(async () => {
      const { db } = await import('../../src/storage/db');
      const now = Date.now();
      const deckId = 'test-multichar-deck';
      await db.decks.put({
        id: deckId,
        parentId: null,
        name: 'MultiChar Test Deck',
        type: 'deck',
        book: 'Test',
        chapter: '1',
        language: 'ja-JP',
        newCardsPerDay: 50,
        reviewsPerDay: 50,
        generateTwinCards: false,
        reviewOrder: 'dueFirst',
        updatedAt: now,
      });

      const noteId = 'test-multichar-note';
      await db.notes.put({
        id: noteId,
        character: '食べる',
        reading: 'たべる',
        meaning: 'To eat',
        exampleSentence: 'りんごを食べます。',
        radicals: ['食'],
        tags: ['test'],
        updatedAt: now,
      });

      await db.cards.put({
        id: 'test-multichar-card',
        noteId,
        deckId,
        direction: 'recognition',
        due: now - 10000,
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        state: 0,
        isSuspended: false,
        isLeech: false,
        updatedAt: now,
      });
    });

    await page.reload();
    await page.waitForSelector('text=MultiChar Test Deck');

    // Launch study for this deck
    const studyDeckBtn = page.locator('[data-testid="deck-node-test-multichar-deck"] button:has-text("Study")').first();
    await studyDeckBtn.click();

    // Ensure Writing Mode / Scratchpad is active
    if (!(await page.locator('text=Character:').isVisible())) {
      const writingToggle = page.locator('button[title*="Writing Mode"]');
      await writingToggle.click();
    }

    // Verify Scratchpad opens with multi-character selector pills: [ 食 ], [ べ ], [ る ]
    await expect(page.locator('text=Character:')).toBeVisible();
    const pill1 = page.locator('button:has-text("食")');
    const pill2 = page.locator('button:has-text("べ")');
    const pill3 = page.locator('button:has-text("る")');
    await expect(pill1).toBeVisible();
    await expect(pill2).toBeVisible();
    await expect(pill3).toBeVisible();

    // Next Char button advances active character
    const nextBtn = page.locator('button[title*="Next Character"]');
    await expect(nextBtn).toBeVisible();
    await nextBtn.click();

    // Active pill changes to 'べ'
    await expect(pill2).toHaveClass(/bg-indigo-600/);

    // Prev Char button navigates back
    const prevBtn = page.locator('button[title*="Previous Character"]');
    await expect(prevBtn).toBeVisible();
    await prevBtn.click();
    await expect(pill1).toHaveClass(/bg-indigo-600/);
  });

  test('verifies front-side spoiler suppression on production cards and reveals on flip', async ({ page }) => {
    // 1. Seed a production card (Meaning -> Character)
    await page.evaluate(async () => {
      const { db } = await import('../../src/storage/db');
      const now = Date.now();
      const deckId = 'test-prod-deck';
      await db.decks.put({
        id: deckId,
        parentId: null,
        name: 'Production Test Deck',
        type: 'deck',
        book: 'Test',
        chapter: '1',
        language: 'ja-JP',
        newCardsPerDay: 50,
        reviewsPerDay: 50,
        generateTwinCards: false,
        reviewOrder: 'dueFirst',
        updatedAt: now,
      });

      const noteId = 'test-prod-note';
      await db.notes.put({
        id: noteId,
        character: '食べる',
        reading: 'たべる',
        meaning: 'To eat (special test meaning)',
        pitchOrTone: '[2]',
        exampleSentence: '毎日食べます。',
        notes: 'Verb note',
        radicals: ['食'],
        tags: ['test'],
        updatedAt: now,
      });

      await db.cards.put({
        id: 'test-prod-card',
        noteId,
        deckId,
        direction: 'production',
        due: now - 10000,
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        state: 0,
        isSuspended: false,
        isLeech: false,
        updatedAt: now,
      });
    });

    await page.reload();
    await page.waitForSelector('text=Production Test Deck');

    // Launch study for production card
    const studyDeckBtn = page.locator('[data-testid="deck-node-test-prod-deck"] button:has-text("Study")').first();
    await studyDeckBtn.click();

    // Verify Card Direction is Meaning -> Character
    await expect(page.locator('text=Meaning → Character')).toBeVisible();

    // FRONT SIDE:
    // 1. Meaning is visible
    await expect(page.locator('text=To eat (special test meaning)')).toBeVisible();

    // 2. Character, reading, and pitch accent MUST NOT be visible on front
    await expect(page.locator('.text-2xl:has-text("食べる")')).not.toBeVisible();
    await expect(page.locator('.text-5xl:has-text("食べる")')).not.toBeVisible();
    await expect(page.locator('text=たべる')).not.toBeVisible();
    await expect(page.locator('text=[2]')).not.toBeVisible();

    // 3. Audio TTS button MUST NOT be visible on front of production card
    await expect(page.locator('button[title="Play Audio (R)"]')).not.toBeVisible();

    // 4. Scratchpad on front side: SVG ghost text must NOT spoil character
    const char1Btn = page.locator('button:has-text("Char 1")');
    if (!(await char1Btn.isVisible())) {
      const writingToggle = page.locator('button[title*="Writing Mode"]');
      await writingToggle.click();
    }
    // Character pills are masked as "Char 1", "Char 2", "Char 3"
    await expect(page.locator('button:has-text("Char 1")')).toBeVisible();
    await expect(page.locator('button:has-text("Char 2")')).toBeVisible();
    await expect(page.locator('button:has-text("Char 3")')).toBeVisible();

    // FLIP CARD (Show Answer)
    const showAnswerBtn = page.locator('button:has-text("Show Answer")');
    await expect(showAnswerBtn).toBeVisible();
    await showAnswerBtn.click();

    // BACK SIDE:
    // Target character and reading are now revealed
    await expect(page.getByText('食べる', { exact: true })).toBeVisible();
    await expect(page.getByText('たべる', { exact: true })).toBeVisible();
    await expect(page.getByText('[2]', { exact: true })).toBeVisible();

    // Scratchpad character pills unmask from "Char 1" to actual characters "食", "べ", "る"
    await expect(page.locator('button[title*="Select character \\"食\\""]')).toBeVisible();
    await expect(page.locator('button:has-text("べ")')).toBeVisible();
    await expect(page.locator('button:has-text("る")')).toBeVisible();

    // Audio TTS button is now accessible
    await expect(page.locator('button[title="Play Audio (R)"]')).toBeVisible();

    // 4 Rating buttons are now visible
    await expect(page.locator('button:has-text("Again")')).toBeVisible();
    await expect(page.locator('button:has-text("Hard")')).toBeVisible();
    await expect(page.locator('button:has-text("Good")')).toBeVisible();
    await expect(page.locator('button:has-text("Easy")')).toBeVisible();
  });

  test('verifies sticky bottom action buttons are always within viewport bounds', async ({ page }) => {
    // Launch study session
    const studyBookBtn = page.locator('button:has-text("Study Book")').first();
    await expect(studyBookBtn).toBeVisible();
    await studyBookBtn.click();

    const checkStickyFooterInViewport = async () => {
      const isVisibleInViewport = await page.evaluate(() => {
        const stickyFooter = document.querySelector('.sticky.bottom-0');
        if (!stickyFooter) return false;
        const rect = stickyFooter.getBoundingClientRect();
        const windowHeight = window.innerHeight;
        // Bounding rect bottom should touch or be inside window bottom, and top must be visible
        return rect.bottom <= windowHeight + 2 && rect.top < windowHeight && rect.height > 0;
      });
      return isVisibleInViewport;
    };

    // 1. Verify on Front (Show Answer button)
    const showAnswerBtn = page.locator('button:has-text("Show Answer")');
    await expect(showAnswerBtn).toBeVisible();
    expect(await checkStickyFooterInViewport()).toBe(true);

    // 2. Ensure writing mode is active to make content tall
    if (!(await page.locator('text=Clear Scratchpad').isVisible())) {
      const writingToggle = page.locator('button[title*="Writing Mode"]');
      await writingToggle.click();
    }
    await page.waitForTimeout(200);

    // Sticky footer must still remain firmly within viewport
    expect(await checkStickyFooterInViewport()).toBe(true);

    // 3. Flip card to reveal back side with rating buttons
    await showAnswerBtn.click();
    await expect(page.locator('button:has-text("Good")')).toBeVisible();
    expect(await checkStickyFooterInViewport()).toBe(true);
  });
});

