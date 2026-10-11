import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// テストのファイルごとに、まだ当たっていないマイグレーションを D1 に当てる。本番と同じ migrations/ の SQL を使う（ADR 0005）
// TEST_MIGRATIONS は vitest.config.ts だけが渡す binding なので、本番の Env の型には足さない
const { DB, TEST_MIGRATIONS } = env as Env & { TEST_MIGRATIONS: D1Migration[] };

await applyD1Migrations(DB, TEST_MIGRATIONS);
