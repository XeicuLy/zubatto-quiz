import { defineProject } from 'vitest/config';

// README と手順書が、リポジトリの今の設定とずれていないかを確かめる
export default defineProject({
  test: {
    name: 'docs',
    environment: 'node',
  },
});
