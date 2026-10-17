import { describe, expect, it } from 'vitest';

import {
  buildReport,
  emptyMetrics,
  formatMarkdownTable,
  percentile,
  plannedMetrics,
  summarizeLatency,
  tallyAnswers,
  type AnswerOutcome,
  type RunMetrics,
} from './metrics.ts';

/** 1, 2, …, n の並び。値と順位が同じなので、何番目を取ったかがそのまま読める */
const oneTo = (n: number) => Array.from({ length: n }, (_, index) => index + 1);

describe('percentile', () => {
  it.each([
    // [件数, p, 期待する値（= 1から数えた順位）]
    [20, 95, 19],
    [100, 95, 95],
    [250, 95, 238],
    [1, 95, 1],
    [4, 50, 2],
    [5, 50, 3],
    [10, 100, 10],
    // 28 / 100 は2進数でちょうど表せず、先に割ると 25 × 0.28 = 7.000000000000001 が切り上がって8になる
    [25, 28, 7],
  ])('%i 件の %i パーセンタイルは %i 番目の値', (count, p, expected) => {
    expect(percentile(oneTo(count), p)).toBe(expected);
  });

  it('値をならさず、測った値のどれかを返す', () => {
    expect(percentile([10, 20, 30, 1000], 95)).toBe(1000);
  });
});

describe('summarizeLatency', () => {
  it('並んでいない値を並べてから、95パーセンタイルと最大を出す', () => {
    expect(summarizeLatency([30, 10, 20], 3)).toEqual({ count: 3, expected: 3, p95: 30, max: 30 });
  });

  it('1件も届かなければ null', () => {
    expect(summarizeLatency([], 50)).toEqual({ count: 0, expected: 50, p95: null, max: null });
  });

  it('渡した配列を並べ替えない', () => {
    const samples = [3, 1, 2];
    summarizeLatency(samples, 3);
    expect(samples).toEqual([3, 1, 2]);
  });
});

describe('tallyAnswers', () => {
  it('結果ごとに数え、断られたものは code ごとに分ける', () => {
    const answers: AnswerOutcome[] = [
      { kind: 'accepted' },
      { kind: 'accepted' },
      { kind: 'rejected', code: 'not_accepting' },
      { kind: 'rejected', code: 'not_accepting' },
      { kind: 'rejected', code: 'already_answered' },
      { kind: 'no_reply' },
      { kind: 'unsent' },
    ];
    expect(tallyAnswers(9, answers)).toEqual({
      planned: 9,
      accepted: 2,
      rejected: { not_accepting: 2, already_answered: 1 },
      noReply: 1,
      unsent: 1,
      missing: 2,
    });
  });
});

/** 全員に届き、どれも速かったリハーサル。テストごとに1か所だけ変える */
function goodRun(): RunMetrics {
  const metrics = emptyMetrics();
  metrics.latencies.showQuestion = { samples: [120, 80, 300], expected: 3 };
  metrics.latencies.startAnswering = { samples: [90, 110, 100], expected: 3 };
  metrics.latencies.closeAnswering = { samples: [400, 420, 1000], expected: 3 };
  metrics.latencies.results = { samples: [350], expected: 1 };
  metrics.plannedAnswers = 3;
  metrics.answers = [{ kind: 'accepted' }, { kind: 'accepted' }, { kind: 'accepted' }];
  return metrics;
}

describe('plannedMetrics', () => {
  it('ボットへの P1 と P3 は部屋 × ボット × 問題、ホストへの P4 は部屋 × 問題の件数を見込む', () => {
    const metrics = plannedMetrics({ rooms: 5, bots: 50, questions: 3 });
    expect(metrics.latencies.showQuestion.expected).toBe(750);
    expect(metrics.latencies.startAnswering.expected).toBe(750);
    expect(metrics.latencies.closeAnswering.expected).toBe(750);
    expect(metrics.latencies.results.expected).toBe(15);
    expect(metrics.plannedAnswers).toBe(750);
  });

  it('何も届かないまま終わったら、どの行も満たしていない', () => {
    expect(buildReport(plannedMetrics({ rooms: 1, bots: 20, questions: 3 })).map((row) => row.passed)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('buildReport', () => {
  it('P1 の3つ・P4・P3 の順に行を作る', () => {
    expect(buildReport(goodRun())).toEqual([
      {
        label: 'P1 出題',
        target: '全員に届き、最大 1000 ms 以内',
        result: 'p95 300 ms・最大 300 ms（3 / 3 件）',
        passed: true,
      },
      {
        label: 'P1 受付開始',
        target: '全員に届き、最大 1000 ms 以内',
        result: 'p95 110 ms・最大 110 ms（3 / 3 件）',
        passed: true,
      },
      {
        label: 'P1 締切',
        target: '全員に届き、最大 1000 ms 以内',
        result: 'p95 1000 ms・最大 1000 ms（3 / 3 件）',
        passed: true,
      },
      {
        label: 'P4 締切から結果',
        target: '全員に届き、最大 2000 ms 以内',
        result: 'p95 350 ms・最大 350 ms（1 / 1 件）',
        passed: true,
      },
      {
        label: 'P3 回答の取りこぼし',
        target: '予定した回答がすべて受理される',
        result: '3 / 3 件を受理',
        passed: true,
      },
    ]);
  });

  it('目標をちょうど超えたら満たしていない', () => {
    const metrics = goodRun();
    metrics.latencies.closeAnswering.samples.push(1000.6);
    metrics.latencies.closeAnswering.expected = 4;
    expect(buildReport(metrics)[2]).toMatchObject({ passed: false, result: 'p95 1001 ms・最大 1001 ms（4 / 4 件）' });
  });

  it('届かなかったボットがいたら、速くても満たしていない', () => {
    const metrics = goodRun();
    metrics.latencies.showQuestion.expected = 4;
    expect(buildReport(metrics)[0]).toMatchObject({ passed: false, result: 'p95 300 ms・最大 300 ms（3 / 4 件）' });
  });

  it('1件も測れなかった行は、測れなかったとして満たしていない', () => {
    const metrics = goodRun();
    metrics.latencies.results = { samples: [], expected: 0 };
    expect(buildReport(metrics)[3]).toMatchObject({ passed: false, result: '測れなかった（0 / 0 件）' });
  });

  it('取りこぼしたら、その内訳を出して満たしていない', () => {
    const metrics = goodRun();
    metrics.plannedAnswers = 6;
    metrics.answers.push({ kind: 'rejected', code: 'not_accepting' }, { kind: 'no_reply' });
    expect(buildReport(metrics)[4]).toMatchObject({
      passed: false,
      result: '3 / 6 件を受理（not_accepting 1・返事なし 1・答えず 1）',
    });
  });
});

describe('formatMarkdownTable', () => {
  it('見出しと区切りの行のあとに、1行ずつ並べる', () => {
    const table = formatMarkdownTable([
      { label: 'P1 出題', target: '1秒', result: 'p95 300 ms', passed: true },
      { label: 'P3', target: '全部', result: '2 / 3 件', passed: false },
    ]);
    expect(table).toBe(
      [
        '| 測ったもの | 目標 | 結果 | 満たしたか |',
        '| --- | --- | --- | --- |',
        '| P1 出題 | 1秒 | p95 300 ms | 満たした |',
        '| P3 | 全部 | 2 / 3 件 | 満たしていない |',
      ].join('\n'),
    );
  });

  it('セルの中の | を逃がし、表の列をずらさない', () => {
    const table = formatMarkdownTable([{ label: 'a|b', target: 't', result: 'r', passed: true }]);
    expect(table.split('\n')[2]).toBe('| a\\|b | t | r | 満たした |');
  });
});
