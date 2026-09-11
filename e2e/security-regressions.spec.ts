import { test, expect } from '@playwright/test';

test.describe('BlindDrop security regressions', () => {
  test('crafted_secret_is_rendered_literally_without_script_execution', async ({ page }) => {
    const crafted = '</textarea><img src=x onerror=window.__xss=1>';
    const injectedRequests: string[] = [];
    page.on('request', request => {
      if (request.url().endsWith('/x') || request.url().includes('/x?')) injectedRequests.push(request.url());
    });

    await page.goto('/');
    await page.locator('#secret-input').fill(crafted);
    await page.locator('#action-btn').click();
    const shareUrl = await page.locator('#share-link').inputValue();
    await page.goto('about:blank');
    await page.goto(shareUrl);
    await page.locator('#action-btn').click();

    await expect(page.locator('#decrypted-secret')).toHaveValue(crafted);
    expect(await page.locator('img').count()).toBe(0);
    expect(await page.evaluate(() => (window as Window & { __xss?: number }).__xss)).toBeUndefined();
    expect(injectedRequests).toEqual([]);
  });

  test('api_error_is_rendered_as_text', async ({ page }) => {
    const id = '00000000-0000-4000-8000-000000000000';
    const message = '<b id="injected-error">not markup</b>';
    await page.route(`**/api/secrets/${id}/meta`, route => route.fulfill({
      status: 404,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ error: message })
    }));

    await page.goto(`/#id=${id}&key=AA==`);
    await expect(page.locator('#notice-message')).toHaveText(message);
    expect(await page.locator('#injected-error').count()).toBe(0);
  });

  test('whitespace_and_unicode_round_trip_without_changes', async ({ page }) => {
    const secret = '  first line\nsecond line — café & <tag>  ';
    await page.goto('/');
    await page.locator('#secret-input').fill(secret);
    await page.locator('#action-btn').click();
    const shareUrl = await page.locator('#share-link').inputValue();
    await page.goto('about:blank');
    await page.goto(shareUrl);
    await page.locator('#action-btn').click();
    await expect(page.locator('#decrypted-secret')).toHaveValue(secret);
  });

  test('utf8_plaintext_limit_accepts_100_kib_and_rejects_one_byte_more', async ({ page }) => {
    await page.goto('/');
    await page.locator('#secret-input').fill('é'.repeat(51200));
    await page.locator('#action-btn').click();
    await expect(page.locator('#share-link')).toBeVisible();

    await page.goto('/');
    await page.locator('#secret-input').fill(`${'é'.repeat(51200)}a`);
    const dialog = page.waitForEvent('dialog');
    await page.locator('#action-btn').click();
    const rejected = await dialog;
    expect(rejected.message()).toContain('100 KiB');
    await rejected.dismiss();
    await expect(page.locator('#share-link')).toHaveCount(0);
  });
});
