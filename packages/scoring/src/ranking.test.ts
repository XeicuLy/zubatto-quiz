import { describe, expect, it } from 'vitest';

import fixture from '../fixtures/ranking.json' with { type: 'json' };
import scoreFixture from '../fixtures/score.json' with { type: 'json' };
import type { ScoringConfig } from './config.ts';
import {
  findBiggestClimber,
  findFastest,
  positionOf,
  rankByScore,
  rankUps,
  type Competitor,
  type PlayerPosition,
} from './ranking.ts';
import { scoreAnswer } from './score.ts';

// 表の行は fixtures/ranking.json にあり、Go で書き直すときも同じ JSON を読む。
// どの行も joinOrder をはっきり持ち、expected は関数の戻り値をまるごと書く。
// テスト名は行の name をそのまま使う。it.each の '$name' は名前を引用符で囲んで途中で切り、
// it(name) は oxlint の vitest/valid-title が止めるので、for とテンプレート文字列で書く

const configs = scoreFixture.configs satisfies Record<string, ScoringConfig>;

describe('rankByScore', () => {
  for (const { name, input, expected } of fixture.rankByScore) {
    it(`${name}`, () => {
      expect(rankByScore(input)).toEqual(expected);
    });
  }
});

describe('要件定義書の「20名・10問の例」', () => {
  // P1〜P18 は 1.50 + 0.30 × n 秒で、第 ((n − 1) mod 10) + 1 問だけ間違える。物知りは3.00秒で全問正解。勝負師は0.80秒で第3問と第7問を間違える
  const { input, expected } = fixture.requirementsExample;

  const totals = (config: ScoringConfig): Competitor[] =>
    input.players.map(({ participantId, joinOrder, elapsedMs, wrongQuestions }) => {
      let score = 0;
      for (let q = 1; q <= input.questionCount; q++) {
        score += scoreAnswer({ correct: !wrongQuestions.includes(q), elapsedMs, limitMs: input.limitMs }, config);
      }
      return { participantId, joinOrder, score };
    });

  it('速さの点を入れると、20人全員の点が違い、同点はない', () => {
    const ranks = rankByScore(totals(configs.default)).map(({ rank }) => rank);
    expect(ranks).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('ボーナスなしでは、物知りが1位で、勝負師は6位', () => {
    expect(rankByScore(totals(configs.withoutQuickBonus))).toEqual(expected.withoutQuickBonus);
  });

  it('ボーナスを足すと、勝負師が9,280点で物知りを抜いて1位になる', () => {
    expect(rankByScore(totals(configs.default))).toEqual(expected.default);
  });
});

describe('findFastest', () => {
  for (const { name, input, expected } of fixture.findFastest) {
    it(`${name}`, () => {
      expect(findFastest(input)).toEqual(expected);
    });
  }
});

describe('rankUps と findBiggestClimber', () => {
  // input は前の問題までの合計点と、この問題までの合計点。2つのランキングにしてから比べる
  for (const { name, input, expected } of fixture.rankUpsAndBiggestClimber) {
    it(`${name}`, () => {
      const previous = rankByScore(input.previous);
      const current = rankByScore(input.current);
      expect(Object.fromEntries(rankUps(previous, current))).toEqual(expected.rankUps);
      expect(findBiggestClimber(previous, current)).toEqual(expected.biggestClimber);
    });
  }
});

describe('positionOf', () => {
  // expected は回答者ごとの位置
  for (const { name, input, expected } of fixture.positionOf) {
    it(`${name}`, () => {
      const ranking = rankByScore(input);
      const positions: Record<string, PlayerPosition> = Object.fromEntries(
        input.map(({ participantId }) => [participantId, positionOf(ranking, participantId)]),
      );
      expect(positions).toEqual(expected);
    });
  }

  // 例外の文言は TS の実装のものなので、fixture に入れない
  it('ランキングにいない回答者を渡すと、エラーにする', () => {
    const ranking = rankByScore([{ participantId: 'a', joinOrder: 0, score: 100 }]);
    expect(() => positionOf(ranking, 'nobody')).toThrow('ランキングにいない回答者: nobody');
  });
});
