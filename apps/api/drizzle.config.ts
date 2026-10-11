import { defineConfig } from 'drizzle-kit';

// drizzle-kit はマイグレーションの SQL を作るだけに使う。当てるのは wrangler d1 migrations apply（ADR 0005）
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema/index.ts',
  // wrangler.jsonc の migrations_dir と同じ。wrangler はここの一番上の *.sql だけを読み、meta/ は drizzle-kit が差分をとるのに使う
  out: './migrations',
});
