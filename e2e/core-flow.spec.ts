import { test, expect } from '@playwright/test';

test.describe('BlindDrop core flow', () => {
  test('creates a share link with the random key in the fragment', async ({ page }) => {
    await page.goto('/');
    await page.locator('#secret-input').fill('This is an end-to-end test secret.');
    await page.locator('#action-btn').click();

    const shareLink = page.locator('#share-link');
    await expect(shareLink).toBeVisible();
    const generatedUrl = await shareLink.inputValue();
    expect(generatedUrl).toContain('#id=');
    expect(generatedUrl).toContain('&key=');
  });

  test('metadata and page load do not deliver; one reveal consumes the envelope', async ({ page }) => {
    await page.goto('/');
    await page.locator('#secret-input').fill('Secret for the one-time reveal flow');
    await page.locator('#action-btn').click();
    const shareUrl = await page.locator('#share-link').inputValue();

    let revealRequests = 0;
    let deprecatedRequests = 0;
    page.on('request', request => {
      if (request.url().includes('/api/secrets/') && request.url().endsWith('/reveal')) revealRequests += 1;
      if (request.url().includes('/api/secrets/') && (
        request.url().endsWith('/access') ||
        request.url().endsWith('/consume') ||
        (request.method() === 'GET' && !request.url().endsWith('/meta'))
      )) deprecatedRequests += 1;
    });

    await page.goto('about:blank');
    await page.goto(shareUrl);
    await expect(page.locator('#action-text')).toHaveText('Reveal & Destroy Secret');
    expect(page.url()).not.toContain('#');
    expect(revealRequests).toBe(0);
    expect(deprecatedRequests).toBe(0);

    await page.locator('#action-btn').click();
    await expect(page.locator('#decrypted-secret')).toHaveValue('Secret for the one-time reveal flow');
    expect(revealRequests).toBe(1);
    expect(deprecatedRequests).toBe(0);

    await page.goto('about:blank');
    await page.goto(shareUrl);
    await expect(page.locator('#notice-message')).toContainText('viewed');
    await expect(page.locator('#action-btn')).toBeHidden();
  });

  test('deprecated retrieval routes are absent', async ({ request }) => {
    const id = '00000000-0000-4000-8000-000000000000';
    for (const response of [
      await request.get(`/api/secrets/${id}`),
      await request.post(`/api/secrets/${id}/access`),
      await request.post(`/api/secrets/${id}/consume`)
    ]) {
      expect(response.status()).toBe(404);
      expect((await response.json()).code).toBe('NOT_FOUND');
    }
  });
});
