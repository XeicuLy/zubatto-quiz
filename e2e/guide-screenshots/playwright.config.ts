import { defineConfig } from '@playwright/test';

import base from '../../playwright.config';

/**
 * 使い方のページの画像を撮る設定（pnpm run guide:shots）。E2E と同じ e2e:serve のビルドを、webServer で立ち上げる。
 * 撮るのは capture.ts だけ。ファイル名を *.spec.ts にしないので、CI の E2E（ルートの playwright.config.ts）には入らない
 */
export default defineConfig(base, {
  testDir: '.',
  testMatch: 'capture.ts',
  reporter: 'list',
});
