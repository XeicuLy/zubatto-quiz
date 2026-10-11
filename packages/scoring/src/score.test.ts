import { describe, expect, it } from 'vitest';

import { defaultScoring, type ScoringConfig } from './config.ts';
import { formatSeconds, maxPointsPerQuestion, normalizeElapsedMs, remainingMaxPoints, scoreAnswer } from './score.ts';

/** F12 を作ったあと（T38）の設定。要件定義書の「設定値」の初期値 */
const withQuickBonus: ScoringConfig = { ...defaultScoring, quickBonus: { withinMs: 1000, points: 200 } };

describe('scoreAnswer', () => {
  // 要件定義書「スコアの計算」の「1問の得点の例」の表（M2）。[端末で計った時間, 制限時間, 得点, ボーナスを足したあとの得点]
  it.each([
    [500, 10_000, 975, 1175],
    [1000, 10_000, 950, 1150],
    [1009, 10_000, 950, 1150],
    [1010, 10_000, 949, 949],
    [3520, 10_000, 824, 824],
    [9990, 10_000, 500, 500],
    [10_050, 10_000, 500, 500],
    [350, 5000, 965, 1165],
    [4000, 20_000, 900, 900],
  ])(
    '正解で %i ミリ秒（制限 %i ミリ秒）なら %i 点、ボーナスを足すと %i 点',
    (measuredMs, limitMs, points, withBonus) => {
      expect(scoreAnswer({ correct: true, elapsedMs: measuredMs, limitMs })).toBe(points);
      expect(scoreAnswer({ correct: true, elapsedMs: measuredMs, limitMs }, withQuickBonus)).toBe(withBonus);
    },
  );

  it('不正解は速さによらず0点で、ボーナスももらえない', () => {
    expect(scoreAnswer({ correct: false, elapsedMs: 100, limitMs: 10_000 })).toBe(0);
    expect(scoreAnswer({ correct: false, elapsedMs: 100, limitMs: 10_000 }, withQuickBonus)).toBe(0);
  });
});

describe('normalizeElapsedMs', () => {
  // [端末で計った時間, 制限時間, 使う経過時間]
  it.each([
    [0, 10_000, 0],
    [9, 10_000, 0],
    [1009, 10_000, 1000],
    [1010, 10_000, 1010],
    [9999, 10_000, 9990],
    [10_000, 10_000, 10_000],
    [10_050, 10_000, 10_000],
    [-30, 10_000, 0],
  ])('%i ミリ秒（制限 %i ミリ秒）は %i ミリ秒として扱う', (measuredMs, limitMs, expected) => {
    expect(normalizeElapsedMs(measuredMs, limitMs)).toBe(expected);
  });
});

describe('formatSeconds', () => {
  // 0.01秒単位の表示。[使う経過時間, 表示]
  it.each([
    [0, '0.00'],
    [10, '0.01'],
    [290, '0.29'],
    [500, '0.50'],
    [1000, '1.00'],
    [1010, '1.01'],
    [3520, '3.52'],
    [10_000, '10.00'],
    [60_000, '60.00'],
  ])('%i ミリ秒は %s 秒と表示する', (elapsedMs, expected) => {
    expect(formatSeconds(elapsedMs)).toBe(expected);
  });

  it('切り捨て前の値を渡しても、四捨五入せずに切り捨てて表示する', () => {
    expect(formatSeconds(1009)).toBe('1.00');
  });
});

describe('配点を設定値だけで変えられる（M2）', () => {
  const custom: ScoringConfig = { basePoints: 100, maxSpeedPoints: 900, quickBonus: { withinMs: 2000, points: 50 } };

  it('基本点・速さの点の上限・ボーナスの条件と点が、渡した設定のとおりになる', () => {
    // 100 + floor(900 × 8000 / 10000) + 50
    expect(scoreAnswer({ correct: true, elapsedMs: 2000, limitMs: 10_000 }, custom)).toBe(870);
    // 2,010ミリ秒はボーナスの条件を外れる: 100 + floor(900 × 7990 / 10000)
    expect(scoreAnswer({ correct: true, elapsedMs: 2010, limitMs: 10_000 }, custom)).toBe(819);
  });

  it('1問で取れる最大の点は、初期値では1,000点、ボーナスを足すと1,200点で、設定を変えればそれに従う', () => {
    expect(maxPointsPerQuestion()).toBe(1000);
    expect(maxPointsPerQuestion(withQuickBonus)).toBe(1200);
    expect(maxPointsPerQuestion(custom)).toBe(1050);
  });

  it('残りの問題で取れる最大の点は、残りの問題数 × 1問の最大の点', () => {
    expect(remainingMaxPoints(7)).toBe(7000);
    expect(remainingMaxPoints(3, withQuickBonus)).toBe(3600);
    expect(remainingMaxPoints(0)).toBe(0);
  });
});
