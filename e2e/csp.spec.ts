import { expect, test } from '@playwright/test';

import { a11yViolations } from './helpers/axe';
import { collectCspViolations } from './helpers/csp';
import { loginAsHost } from './helpers/login';

// full-game.spec.ts の「CSP の違反がない」が空振りしていないことを確かめる。違反を起こせば、ちゃんと集まる
test('インラインのスクリプトを入れると、CSP の違反として集まる', async ({ context, page }) => {
  const violations = collectCspViolations(context);
  await page.goto('/');

  // script-src 'self' は、インラインのスクリプトを止める。止められると、addScriptTag は失敗する
  await page.addScriptTag({ content: 'document.title = "inline";' }).catch(() => {});

  await expect.poll(() => violations.length).toBeGreaterThan(0);
  expect(await page.title()).not.toBe('inline');
});

// HeadContent が出すのは <title> だけで、インラインのスクリプトや style は出さない。出せば script-src 'self' で止まり、違反として集まる
test('ルートのタイトルを HeadContent が出しても、CSP の違反は出ない', async ({ context, page }) => {
  const violations = collectCspViolations(context);
  await page.goto('/login');

  await expect(page).toHaveTitle('ログイン | ズバクイ');
  expect(await page.locator('script:not([src]), style').count()).toBe(0);
  expect(violations).toEqual([]);
});

// 使い方の画像は、同じオリジンのハッシュ付きの URL で配る（assetsInlineLimit: 0）。data: に埋め込むと default-src 'self' に止められる
test('使い方のページは、画像をすべて同じオリジンから読み込み、CSP の違反を出さない', async ({ context, page }) => {
  const violations = collectCspViolations(context);
  await page.goto('/guide');
  await expect(page).toHaveTitle('使い方 | ズバクイ');

  const images = await page.getByRole('img').all();
  expect(images.length).toBeGreaterThan(0);
  for (const image of images) {
    expect(await image.getAttribute('src')).toMatch(/^\/assets\/[^/]+\.png$/);
    // loading="lazy" なので、見える所まで送ってから読めたかを見る。読めなければ naturalWidth は 0 のまま
    await image.scrollIntoViewIfNeeded();
    await expect(image).toHaveJSProperty('naturalWidth', Number(await image.getAttribute('width')));
  }
  expect(violations).toEqual([]);
});

// toast（Base UI）は位置などの値を style prop（CSSOM）で入れ、<style> を作らない。shadcn の sonner は <style> を差し込むので CSP に止められる（#287）
test('問題セットを消したときの toast は、<style> を足さず、CSP の違反を出さない', async ({ context, page }) => {
  const violations = collectCspViolations(context);
  await loginAsHost(context);
  const created = await context.request.post('/api/question-sets', {
    data: {
      title: '消す問題セット',
      questions: [{ text: '1 + 1 は？', choices: ['1', '2'], correctIndex: 1, limitMs: 10_000 }],
    },
  });
  expect(created.status()).toBe(201);
  await page.goto('/admin');

  await page.getByRole('button', { name: '消す' }).click();
  await page.getByRole('button', { name: '本当に消す' }).click();

  const toasts = page.getByRole('region', { name: '通知' });
  await expect(toasts.getByText('「消す問題セット」を消しました')).toBeVisible();
  expect(await page.locator('script:not([src]), style').count()).toBe(0);
  // 色の組は contrast.test.ts で測る。ここでは本物の画面に重なった toast を、axe の color-contrast などで確かめる
  expect(await a11yViolations(page)).toEqual([]);
  expect(violations).toEqual([]);
});
