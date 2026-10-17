import { defineProject } from 'vitest/config';

// デプロイするバンドルの中身を確かめるテスト。wrangler を子のプロセスで動かすので、Workers ではなく node の上で走らせる
export default defineProject({
  test: {
    name: 'api-bundle',
    environment: 'node',
    include: ['test/bundle/**/*.test.ts'],
    // wrangler のバンドルは1回に数秒かかる
    testTimeout: 60_000,
  },
});
