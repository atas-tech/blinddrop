import { test, expect } from '@playwright/test';

test.describe('BlindDrop Passphrase Flow', () => {
  test('Integration 401: Passphrase creation and metadata fetch', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
    
    await page.goto('/');
    
    // Fill secret
    await page.locator('#secret-input').fill('Passphrase protected secret');
    
    // Fill passphrase
    await page.locator('#passphrase-input').fill('correct-horse-battery-staple');
    
    // Bypass turnstile (local)
    await page.waitForTimeout(500);
    
    // Create link
    await page.locator('#action-btn').click();
    
    // Expect share link
    const shareLink = page.locator('#share-link');
    await expect(shareLink).toBeVisible();
    
    const shareUrl = await shareLink.inputValue();
    // Should NOT contain &key= because it's passphrase protected
    expect(shareUrl).not.toContain('&key=');
    expect(shareUrl).toContain('#id=');

    // Now go to the reveal page
    await page.goto('about:blank');
    await page.goto(shareUrl);
    
    // Should see passphrase input
    const passInput = page.locator('#reveal-passphrase');
    await expect(passInput).toBeVisible();
    
    const actionText = page.locator('#action-text');
    await expect(actionText).toHaveText('Reveal & Destroy Secret');
  });

  test('Integration 402: Wrong passphrase and retry', async ({ page }) => {
    await page.goto('/');
    await page.locator('#secret-input').fill('Retryable secret');
    await page.locator('#passphrase-input').fill('mypassword');
    await page.waitForTimeout(500);
    await page.locator('#action-btn').click();
    const shareUrl = await page.locator('#share-link').inputValue();

    // Reveal page
    await page.goto('about:blank');
    await page.goto(shareUrl);
    
    // Enter WRONG passphrase
    await page.locator('#reveal-passphrase').fill('wrongpassword');
    await page.locator('#action-btn').click();
    
    // Should see error notice
    await expect(page.locator('text=Notice')).toBeVisible();
    await expect(page.locator('text=Incorrect passphrase')).toBeVisible();
    
    // Secret should NOT be destroyed. Refresh and try with CORRECT passphrase.
    // Note: We need to wait for the 2s lock to expire as configured in playwright.config.ts
    await page.waitForTimeout(2500); 

    await page.goto('about:blank');
    await page.goto(shareUrl);
    
    await page.locator('#reveal-passphrase').fill('mypassword');
    await page.locator('#action-btn').click();
    
    // Should see decrypted secret
    const decrypted = page.locator('#decrypted-secret');
    await expect(decrypted).toBeVisible();
    await expect(decrypted).toHaveValue('Retryable secret');
  });

  test('Integration 403: Concurrent reveals blocked (Reservation Lock)', async ({ page, browser }) => {
    // 1. Create a secret
    await page.goto('/');
    await page.locator('#secret-input').fill('Locked secret');
    await page.locator('#passphrase-input').fill('lockme');
    await page.waitForTimeout(500);
    await page.locator('#action-btn').click();
    const shareUrl = await page.locator('#share-link').inputValue();

    // 2. Open first user
    const user1 = page;
    await user1.goto('about:blank');
    await user1.goto(shareUrl);
    
    // 3. Open second user in a new context
    const context2 = await browser.newContext();
    const user2 = await context2.newPage();
    await user2.goto(shareUrl);

    // 4. User 1 tries to reveal
    await user1.locator('#reveal-passphrase').fill('lockme');
    
    // DELAY User 1's consume call so the lock stays held
    let resolveConsume: any;
    const consumePromise = new Promise(r => resolveConsume = r);
    await user1.route('**/api/secrets/**/consume', async route => {
      await consumePromise;
      await route.continue();
    });

    await user1.locator('#action-btn').click();
    
    // User 1 should be "Decrypting..." or finished decrypting but stuck on consume
    // User 1 should have already called /access by now.
    await page.waitForTimeout(500); 

    // 5. User 2 tries to reveal IMMEDIATELY
    await user2.locator('#reveal-passphrase').fill('lockme');
    await user2.locator('#action-btn').click();
    
    // User 2 should get a "Locked" error because User 1 is still "consuming" (holding the lock)
    await expect(user2.locator('text=Secret is currently actively being viewed')).toBeVisible();
    
    // Clean up
    resolveConsume();
    await context2.close();
  });
});
