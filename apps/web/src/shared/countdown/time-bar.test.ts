import { describe, expect, it } from 'vitest';

import { timeBarOf } from './time-bar';

describe('timeBarOf', () => {
  it('起点が決まるまでは、届いた残りの割合で止めておく', () => {
    expect(timeBarOf(10_000, { startedAt: null, leftMs: 7000, nextTickMs: 1000 })).toEqual({
      ratio: 0.7,
      transitionMs: 0,
    });
  });

  it('数え始めたら、次に描き直すときの割合へ、それまでの時間をかけて縮める', () => {
    // 残り 6.4 秒。0.4 秒後の描き直しで残り6秒になるので、6/10 へ 400ms かけて縮める
    expect(timeBarOf(10_000, { startedAt: 0, leftMs: 6400, nextTickMs: 400 })).toEqual({
      ratio: 0.6,
      transitionMs: 400,
    });
  });

  it('最後の1秒は、締切の瞬間に0になるよう縮める', () => {
    expect(timeBarOf(10_000, { startedAt: 0, leftMs: 1000, nextTickMs: 1000 })).toEqual({
      ratio: 0,
      transitionMs: 1000,
    });
  });
});
