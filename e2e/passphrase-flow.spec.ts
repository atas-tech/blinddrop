import { test, expect } from '@playwright/test';

test.describe('BlindDrop passphrase flow', () => {
  test('metadata reveals passphrase mode without exposing the salt', async ({ page }) => {
    await page.goto('/');
    await page.locator('#secret-input').fill('Passphrase protected secret');
    await page.locator('#passphrase-input').fill('correct-horse-battery-staple');
    await page.locator('#action-btn').click();

    const shareUrl = await page.locator('#share-link').inputValue();
    expect(shareUrl).toContain('#id=');
    expect(shareUrl).toContain('&key=');

    await page.goto('about:blank');
    await page.goto(shareUrl);
    await expect(page.locator('#reveal-passphrase')).toBeVisible();
    await expect(page.locator('#action-text')).toHaveText('Reveal & Destroy Secret');
  });

  test('wrong passphrase retries against the in-memory envelope only', async ({ page }) => {
    await page.goto('/');
    await page.locator('#secret-input').fill('Retryable secret');
    await page.locator('#passphrase-input').fill('mypassword');
    await page.locator('#action-btn').click();
    const shareUrl = await page.locator('#share-link').inputValue();

    let revealRequests = 0;
    let deprecatedRequests = 0;
    page.on('request', request => {
      if (request.url().endsWith('/reveal')) revealRequests += 1;
      if (request.url().endsWith('/access') || request.url().endsWith('/consume')) deprecatedRequests += 1;
    });

    await page.goto('about:blank');
    await page.goto(shareUrl);
    await page.locator('#reveal-passphrase').fill('wrongpassword');
    await page.locator('#action-btn').click();
    await expect(page.locator('#reveal-error')).toContainText('Incorrect passphrase');
    expect(revealRequests).toBe(1);
    expect(deprecatedRequests).toBe(0);

    await page.locator('#reveal-passphrase').fill('mypassword');
    await page.locator('#action-btn').click();
    await expect(page.locator('#decrypted-secret')).toHaveValue('Retryable secret');
    expect(revealRequests).toBe(1);
    expect(deprecatedRequests).toBe(0);
  });

  test('a lost reveal response is not presented as successful deletion', async ({ page }) => {
    await page.route('**/api/secrets/*/reveal', route => route.abort());
    await page.goto('/');
    await page.locator('#secret-input').fill('Network uncertainty test');
    await page.locator('#action-btn').click();
    const shareUrl = await page.locator('#share-link').inputValue();

    await page.goto('about:blank');
    await page.goto(shareUrl);
    await page.locator('#action-btn').click();
    await expect(page.locator('#notice-message')).toContainText('Unable to reveal');
    await expect(page.locator('#notice-message')).not.toContainText('server deletion confirmed');
    await expect(page.locator('#action-btn')).toBeHidden();
  });
});
