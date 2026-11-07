import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { reactCompiler } from '../react-compiler.ts';

/**
 * Storybook だけが読む Vite の設定（main.ts の viteConfigPath）。
 * apps/web/vite.config.ts から、部品を描くのに要るものだけを写す。
 * - cloudflare は入れない。画面と API の Worker を立ち上げてしまう
 * - tanstackRouter は入れない。ストーリーはルートを持たず、動かすと src/routeTree.gen.ts を書き換える
 * - react と reactCompiler は本番と同じ順にする。片方だけ変えると、本番と違うコードを見ることになる
 */
export default defineConfig({
  plugins: [react(), reactCompiler(), tailwindcss()],
  // @/ は tsconfig の paths で解決する（ADR 0007）。vite.config.ts と同じ理由で alias は使わない
  resolve: { tsconfigPaths: true },
});
