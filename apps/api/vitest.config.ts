import { fileURLToPath } from 'node:url';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineProject } from 'vitest/config';

// マイグレーションの SQL は node の側で読み、binding として Workers の実行環境へ渡す。当てるのは test/apply-migrations.ts
// ルートの vitest から動かしても場所がずれないよう、このファイルからの相対で探す
const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));

// wrangler.jsonc の secrets.required の、テスト用の値。GitHub への通信はテストの中で差し替えるので、本物の値は要らない
const testSecrets = {
  // http なので、Cookie に Secure が付かない（ローカルの vite dev と同じ）
  BETTER_AUTH_URL: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
  GITHUB_CLIENT_ID: 'test-github-client-id',
  GITHUB_CLIENT_SECRET: 'test-github-client-secret',
};
// wrangler は secrets.required の値を .dev.vars・.env・process.env から探し、見つからないと警告する。
// .dev.vars のない CI でも警告が出ないよう、process.env にも入れる
Object.assign(process.env, testSecrets);

export default defineProject({
  // wrangler.jsonc の DO と D1 の binding を、ローカルの Workers の実行環境（workerd）で動かす（ADR 0005）
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // bindings は wrangler が読んだ値より優先される。手元に .dev.vars（本物の値）があっても、テストはテスト用の値で動く
      miniflare: { bindings: { TEST_MIGRATIONS: migrations, ...testSecrets } },
    }),
  ],
  test: {
    name: 'api',
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
