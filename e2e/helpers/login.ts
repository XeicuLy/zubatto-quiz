import type { BrowserContext, Cookie } from '@playwright/test';

import { E2E_LOGIN_PATH } from '../../apps/api/test/e2e-login-path';

/**
 * そのブラウザのコンテキストを、新しいホストとしてログインさせる。GitHub は通らない。
 * 経路はテスト専用の入口（apps/api/test/e2e-entry.ts）にだけあり、本番の API の Worker にはない（ADR 0003）
 */
export async function loginAsHost(context: BrowserContext): Promise<void> {
  const response = await context.request.post(E2E_LOGIN_PATH);
  if (!response.ok()) {
    throw new Error(`E2E 用のログインに失敗しました: ${response.status()} ${await response.text()}`);
  }
  const { cookies } = (await response.json()) as { cookies: Cookie[] };
  await context.addCookies(cookies);
}
