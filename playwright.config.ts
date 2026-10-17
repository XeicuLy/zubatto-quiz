import { defineConfig, devices } from '@playwright/test';

/** E2E の画面のオリジン。apps/web の e2e:serve のポートと、apps/api/.dev.vars.e2e の BETTER_AUTH_URL と同じ */
const baseURL = 'http://localhost:4173';

/**
 * 通しの E2E（T33）。本番と同じビルドを vite preview で動かし、public/_headers の CSP も効かせる（vite dev では効かない）。
 * API の Worker だけは、テスト専用の入口（apps/api/test/e2e-entry.ts）で作る（ADR 0003）
 */
export default defineConfig({
  testDir: './e2e',
  // 落ちたテストを、もう一度走らせて通ったことにしない。不安定なら直す
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @zubatto-quiz/web run e2e:serve',
    url: `${baseURL}/api/health`,
    // 前のビルドのサーバーを使い回さない。いまのコードでビルドし直し、D1 と DO も空から始める
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
