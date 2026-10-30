import { fileURLToPath } from 'node:url';

import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** E2E のローカルの D1 と DO の置き場所。package.json の e2e:serve が、毎回空にしてからマイグレーションを当てる */
const E2E_STATE_PATH = '.wrangler/e2e';

export default defineConfig(({ mode }) => ({
  plugins: [
    // react より前に置く。src/routes から src/routeTree.gen.ts を作り、ルートごとにコードを分ける
    // テストのファイル（*.test.tsx）は経路にしない
    tanstackRouter({ target: 'react', autoCodeSplitting: true, routeFileIgnorePattern: String.raw`\.test\.` }),
    react(),
    tailwindcss(),
    // vite dev 1つで、画面の Worker と API の Worker（部屋の DO を含む）を動かす（ADR 0006）
    // --mode e2e（.env.e2e の CLOUDFLARE_ENV）では、両方の Worker を wrangler.jsonc の env.e2e で作る。
    // E2E のローカルの D1 と部屋の DO は、vite dev のもの（.wrangler/state）とは別の場所に置き、開発のデータを汚さない
    cloudflare({
      auxiliaryWorkers: [{ configPath: '../api/wrangler.jsonc' }],
      persistState: mode === 'e2e' ? { path: E2E_STATE_PATH } : true,
    }),
  ],
  // @/ はこのアプリの src/（ADR 0007）。tsconfig.app.json の paths と同じにする
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    // 小さなファイル（日本語フォントの一部など）を data: の URL で CSS や JS に埋め込まない。
    // CSP の default-src 'self' は data: を許さないので、埋め込むとそのフォントや画像が読めなくなる（ADR 0004）
    assetsInlineLimit: 0,
  },
}));
