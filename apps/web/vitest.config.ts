import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

import { reactCompiler } from './react-compiler.ts';

export default defineProject({
  // vite.config.ts は読まない。Cloudflare のプラグインが Worker を立ち上げてしまうため
  // テストのファイル（*.test.tsx）は経路にしない。vite.config.ts と同じ設定にする
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true, routeFileIgnorePattern: String.raw`\.test\.` }),
    react(),
    reactCompiler(),
  ],
  // vite.config.ts を読まないので、@/ を tsconfig の paths で解決する設定もここに書く
  resolve: { tsconfigPaths: true },
  test: {
    name: 'web',
    // 画面のコンポーネントは jsdom で描く。Worker の入口のテストは、ファイルの先頭で node に切り替える
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
