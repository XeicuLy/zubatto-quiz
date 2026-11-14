import { defineProject } from 'vitest/config';

// 版の判定と文面づくりを、git につながずに確かめる
export default defineProject({
  test: {
    name: 'release',
    environment: 'node',
  },
});
