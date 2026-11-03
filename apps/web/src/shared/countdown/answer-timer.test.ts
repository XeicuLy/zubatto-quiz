import { describe, expect, it } from 'vitest';

import { answerStartOf, elapsedMsAt, remainingMsAt } from './answer-timer';

describe('answerStartOf', () => {
  it('ふだんは選択肢を表示した瞬間が起点になる', () => {
    expect(answerStartOf(5000, 10_000, 10_000)).toBe(5000);
  });

  it('つなぎ直して残りが短く届いたときは、切れていたぶん前にずらす', () => {
    // 受付から3秒たって送り直された。表示した瞬間には、もう3秒たっている
    expect(answerStartOf(5000, 10_000, 7000)).toBe(2000);
  });
});

describe('elapsedMsAt（P2）', () => {
  it.each([
    { startedAt: 1000, now: 1000, expected: 0 },
    { startedAt: 1000, now: 3370, expected: 2370 },
    // 送るのは整数のミリ秒。切り捨てて、サーバーの0.01秒単位の切り捨てで繰り上がらないようにする
    { startedAt: 1000, now: 2009.6, expected: 1009 },
    { startedAt: 1000.4, now: 2000, expected: 999 },
    // 表示の前の時刻では負にしない（protocol は0以上を求める）
    { startedAt: 1000, now: 999, expected: 0 },
  ])('$startedAt から $now までは $expected ms', ({ startedAt, now, expected }) => {
    expect(elapsedMsAt(startedAt, now)).toBe(expected);
  });
});

describe('remainingMsAt', () => {
  it.each([
    { now: 0, expected: 10_000 },
    { now: 2500, expected: 7500 },
    { now: 10_000, expected: 0 },
    // 締切を過ぎても負にしない。0なら締切
    { now: 12_000, expected: 0 },
  ])('制限10秒で、起点から $now ms なら残り $expected ms', ({ now, expected }) => {
    expect(remainingMsAt(0, 10_000, now)).toBe(expected);
  });
});
