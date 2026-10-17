import { describe, expect, it } from 'vitest';

import { answerDelayMs } from './bot.ts';

describe('answerDelayMs', () => {
  it.each([
    // [mode, random() の値, 期待する待ち時間（残り10秒）]
    ['spread', 0, 0],
    ['spread', 0.5, 4_500],
    // random() は1未満なので、残りの90%には届かない。締切までに1秒の余裕が残る
    ['spread', 0.999, 8_991],
    ['burst', 0, 8_500],
    ['burst', 0.999, 8_999.5],
  ] as const)('%s で random() が %d なら %d ms', (mode, random, expected) => {
    expect(answerDelayMs(mode, 10_000, () => random)).toBeCloseTo(expected);
  });

  it('つなぎ直して残りが短いときは、残りの時間に合わせる', () => {
    expect(answerDelayMs('burst', 2_000, () => 0)).toBe(1_700);
  });
});
