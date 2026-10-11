import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineProject } from 'vitest/config';

export default defineProject({
  // wrangler.jsonc の DO と D1 の binding を、ローカルの Workers の実行環境（workerd）で動かす（ADR 0005）
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    name: 'api',
  },
});
