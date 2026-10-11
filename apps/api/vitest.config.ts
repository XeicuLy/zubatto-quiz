import { fileURLToPath } from 'node:url';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineProject } from 'vitest/config';

// マイグレーションの SQL は node の側で読み、binding として Workers の実行環境へ渡す。当てるのは test/apply-migrations.ts
// ルートの vitest から動かしても場所がずれないよう、このファイルからの相対で探す
const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));

export default defineProject({
  // wrangler.jsonc の DO と D1 の binding を、ローカルの Workers の実行環境（workerd）で動かす（ADR 0005）
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
  test: {
    name: 'api',
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
