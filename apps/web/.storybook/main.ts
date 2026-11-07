import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook の設定。部品の見た目の目録で、手元で起動し、CI はビルドの確認だけにする（公開しない）。
 * ストーリーは部品の隣（button.tsx なら button.stories.tsx）に置く。本番の dist と CSS には入れない（docs/architecture/frontend.md の Storybook）
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  // play 関数・addon-vitest・addon-a11y は入れない。振る舞いは部品のテストと E2E で確かめる
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {
      // apps/web/vite.config.ts は読まない。Cloudflare のプラグインが Worker を立ち上げ、ルーターのプラグインが routeTree.gen.ts を書き換える
      builder: { viteConfigPath: '.storybook/vite.config.ts' },
    },
  },
  // 使い方の情報を外へ送らない
  core: { disableTelemetry: true },
};

export default config;
