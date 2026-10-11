import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // react より前に置く。src/routes から src/routeTree.gen.ts を作り、ルートごとにコードを分ける
    // テストのファイル（*.test.tsx）は経路にしない
    tanstackRouter({ target: 'react', autoCodeSplitting: true, routeFileIgnorePattern: String.raw`\.test\.` }),
    react(),
    tailwindcss(),
    // vite dev 1つで、画面の Worker と API の Worker（部屋の DO を含む）を動かす（ADR 0006）
    cloudflare({ auxiliaryWorkers: [{ configPath: '../api/wrangler.jsonc' }] }),
  ],
  build: {
    // 小さなファイル（日本語フォントの一部など）を data: の URL で CSS や JS に埋め込まない。
    // CSP の default-src 'self' は data: を許さないので、埋め込むとそのフォントや画像が読めなくなる（ADR 0004）
    assetsInlineLimit: 0,
  },
});
