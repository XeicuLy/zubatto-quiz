import { defineProject } from 'vitest/config';

// 集計の関数など、部屋につながずに確かめられるところだけをテストする
export default defineProject({
  test: {
    name: 'loadtest',
    environment: 'node',
  },
});
