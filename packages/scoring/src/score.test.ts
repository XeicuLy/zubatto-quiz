import { describe, expect, it } from 'vitest';

import fixture from '../fixtures/score.json' with { type: 'json' };
import { defaultScoring, type ScoringConfig } from './config.ts';
import {
  formatSeconds,
  maxPointsPerQuestion,
  normalizeElapsedMs,
  quickBonusPoints,
  remainingMaxPoints,
  scoreAnswer,
} from './score.ts';

// 表の行は fixtures/score.json にあり、Go で書き直すときも同じ JSON を読む。
// 期待値の config は名前で引く。default は config.ts の defaultScoring と同じ値で、下のテストがずれを見つける

/** F12 の早押しボーナスを入れない設定。要件定義書の表の「得点」の列は、この設定での値 */
const { withoutQuickBonus } = fixture.configs satisfies Record<string, ScoringConfig>;

describe('defaultScoring', () => {
  it('要件定義書の「設定値」の初期値どおりで、F12 の早押しボーナスは1.00秒以内の正解に200点', () => {
    // config.ts を変えたら（M2）、fixtures/score.json の configs.default と期待値も直す
    expect(defaultScoring).toEqual(fixture.configs.default);
  });
});

describe('scoreAnswer', () => {
  // 要件定義書「スコアの計算」の「1問の得点の例」の表（M2）。input.elapsedMs は端末で計った時間で、expected は config の名前ごとの得点
  for (const { input, expected } of fixture.scoreAnswer) {
    it(`正解で ${input.elapsedMs} ミリ秒（制限 ${input.limitMs} ミリ秒）なら ${expected.withoutQuickBonus} 点、ボーナスを足すと ${expected.default} 点`, () => {
      expect(scoreAnswer(input, withoutQuickBonus)).toBe(expected.withoutQuickBonus);
      expect(scoreAnswer(input)).toBe(expected.default);
    });
  }

  it('不正解は速さによらず0点で、ボーナスももらえない', () => {
    expect(scoreAnswer({ correct: false, elapsedMs: 100, limitMs: 10_000 }, withoutQuickBonus)).toBe(0);
    expect(scoreAnswer({ correct: false, elapsedMs: 100, limitMs: 10_000 })).toBe(0);
  });
});

describe('quickBonusPoints', () => {
  // 境目は「以内」（ちょうど1.00秒を含む）。切り捨てたあとの経過時間で比べる（P2）。expected は初期値の設定でのボーナス
  for (const { input, expected } of fixture.quickBonusPoints) {
    it(`${input.elapsedMs} ミリ秒で正解=${input.correct} なら、ボーナスは ${expected} 点`, () => {
      expect(quickBonusPoints(input)).toBe(expected);
    });
  }

  it('設定に quickBonus を入れていなければ、どんなに速くても0点', () => {
    expect(quickBonusPoints({ correct: true, elapsedMs: 0, limitMs: 10_000 }, withoutQuickBonus)).toBe(0);
  });

  it('scoreAnswer の得点には、このボーナスがそのまま入っている', () => {
    const answer = { correct: true, elapsedMs: 500, limitMs: 10_000 };
    expect(scoreAnswer(answer) - scoreAnswer(answer, withoutQuickBonus)).toBe(quickBonusPoints(answer));
  });
});

describe('normalizeElapsedMs', () => {
  // expected は使う経過時間
  for (const { input, expected } of fixture.normalizeElapsedMs) {
    it(`${input.measuredMs} ミリ秒（制限 ${input.limitMs} ミリ秒）は ${expected} ミリ秒として扱う`, () => {
      expect(normalizeElapsedMs(input.measuredMs, input.limitMs)).toBe(expected);
    });
  }
});

describe('formatSeconds', () => {
  // 0.01秒単位の表示。input.elapsedMs は使う経過時間
  for (const { input, expected } of fixture.formatSeconds) {
    it(`${input.elapsedMs} ミリ秒は ${expected} 秒と表示する`, () => {
      expect(formatSeconds(input.elapsedMs)).toBe(expected);
    });
  }

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

  it('1問で取れる最大の点は、ボーナスを入れなければ1,000点、初期値ではボーナスを足して1,200点で、設定を変えればそれに従う', () => {
    expect(maxPointsPerQuestion(withoutQuickBonus)).toBe(1000);
    expect(maxPointsPerQuestion()).toBe(1200);
    expect(maxPointsPerQuestion(custom)).toBe(1050);
  });

  it('残りの問題で取れる最大の点は、残りの問題数 × 1問の最大の点で、初期値ではボーナスも含む（F15）', () => {
    expect(remainingMaxPoints(7)).toBe(8400);
    expect(remainingMaxPoints(3, withoutQuickBonus)).toBe(3000);
    expect(remainingMaxPoints(0)).toBe(0);
  });
});
