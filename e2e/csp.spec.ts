import { expect, test } from '@playwright/test';

import { collectCspViolations } from './helpers/csp';

// full-game.spec.ts の「CSP の違反がない」が空振りしていないことを確かめる。違反を起こせば、ちゃんと集まる
test('インラインのスクリプトを入れると、CSP の違反として集まる', async ({ context, page }) => {
  const violations = collectCspViolations(context);
  await page.goto('/');

  // script-src 'self' は、インラインのスクリプトを止める。止められると、addScriptTag は失敗する
  await page.addScriptTag({ content: 'document.title = "inline";' }).catch(() => {});

  await expect.poll(() => violations.length).toBeGreaterThan(0);
  expect(await page.title()).not.toBe('inline');
});
