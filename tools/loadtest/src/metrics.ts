import type { ErrorCode } from '@zubatto-quiz/protocol';

/**
 * リハーサルの集計（O2・P1・P3・P4・SC2）。部屋につながない純粋な関数だけを置き、テストで確かめる。
 * 測った値を入れる RunMetrics は run.ts が作り、bot.ts と host.ts が書き足す
 */

/**
 * 測る時間の種類。どれも、ホスト役が進行操作を送った時刻からの経過ミリ秒を、同じプロセスの performance.now() で測る
 *
 * - showQuestion: 出題 → 各ボットの questionShown（P1）
 * - startAnswering: 受付開始 → 各ボットの answeringStarted（P1）
 * - closeAnswering: 締切 → 各ボットの myResult（P1）
 * - results: 締切 → ホストの revealed。ホストが結果を出せるようになるまで（P4）
 */
export type LatencyKind = 'showQuestion' | 'startAnswering' | 'closeAnswering' | 'results';

/** 表の行の並びと、目標（requirements の P1・P4） */
export const LATENCY_TARGETS: readonly { kind: LatencyKind; label: string; targetMs: number }[] = [
  { kind: 'showQuestion', label: 'P1 出題', targetMs: 1_000 },
  { kind: 'startAnswering', label: 'P1 受付開始', targetMs: 1_000 },
  { kind: 'closeAnswering', label: 'P1 締切', targetMs: 1_000 },
  { kind: 'results', label: 'P4 締切から結果', targetMs: 2_000 },
];

/**
 * ボット1体の、1問ぶんの回答の結果（P3）
 *
 * - accepted: answerAccepted が届いた（部屋の DO に回答が残った）
 * - rejected: 回答のあとに error が届いた（締切のあとに届いた not_accepting など）
 * - no_reply: 送ったのに、その問題の結果が届くまで返事がなかった
 * - unsent: 接続が開いておらず、送れなかった
 */
export type AnswerOutcome =
  | { kind: 'accepted' }
  | { kind: 'rejected'; code: ErrorCode }
  | { kind: 'no_reply' }
  | { kind: 'unsent' };

/** 1回のリハーサルで測ったもの。expected は、全員に届けば集まるはずの件数 */
export interface RunMetrics {
  latencies: Record<LatencyKind, { samples: number[]; expected: number }>;
  /** 回答する予定だった数（部屋 × ボット × 問題）。答えなかったボットも数えるので、answers より多いことがある */
  plannedAnswers: number;
  answers: AnswerOutcome[];
  /** 表の下に出す補足（alarm が先に締め切った問題など） */
  notes: string[];
}

export function emptyMetrics(): RunMetrics {
  return {
    latencies: {
      showQuestion: { samples: [], expected: 0 },
      startAnswering: { samples: [], expected: 0 },
      closeAnswering: { samples: [], expected: 0 },
      results: { samples: [], expected: 0 },
    },
    plannedAnswers: 0,
    answers: [],
    notes: [],
  };
}

/**
 * 走らせる前に、全員に届けば集まる件数を入れておく。
 * 部屋ごと止まったり、入れなかったボットがいたりしても、件数が足りずに「満たしていない」になる
 */
export function plannedMetrics({
  rooms,
  bots,
  questions,
}: {
  rooms: number;
  bots: number;
  questions: number;
}): RunMetrics {
  const metrics = emptyMetrics();
  const perBot = rooms * bots * questions;
  metrics.latencies.showQuestion.expected = perBot;
  metrics.latencies.startAnswering.expected = perBot;
  metrics.latencies.closeAnswering.expected = perBot;
  // P4 はホストへの revealed なので、部屋 × 問題の数だけ
  metrics.latencies.results.expected = rooms * questions;
  metrics.plannedAnswers = perBot;
  return metrics;
}

/**
 * 小さい順に並べた値の、p パーセンタイル（0 < p <= 100）。
 * 最近順位法で、値をならさずに、実際に測ったどれか1つを返す。
 * 「95% の人は、この時間までに受け取った」と読める
 */
export function percentile(sorted: readonly number[], p: number): number {
  // 1から数えた順位。掛けてから割る。先に p / 100 にすると、25件の28パーセンタイルが 7.000000000000001 で8番目に切り上がる
  const rank = Math.ceil((p * sorted.length) / 100);
  return sorted[rank - 1]!;
}

export interface LatencySummary {
  /** 届いた件数 */
  count: number;
  /** 届くはずだった件数 */
  expected: number;
  /** 1件も届かなければ null */
  p95: number | null;
  max: number | null;
}

export function summarizeLatency(samples: readonly number[], expected: number): LatencySummary {
  if (samples.length === 0) {
    return { count: 0, expected, p95: null, max: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { count: sorted.length, expected, p95: percentile(sorted, 95), max: sorted.at(-1)! };
}

export interface AnswerTally {
  planned: number;
  accepted: number;
  rejected: Partial<Record<ErrorCode, number>>;
  noReply: number;
  unsent: number;
  /** 予定した数のうち、どれにも当たらなかった数（受付開始が届かず、答えられなかったなど） */
  missing: number;
}

export function tallyAnswers(planned: number, answers: readonly AnswerOutcome[]): AnswerTally {
  const tally: AnswerTally = { planned, accepted: 0, rejected: {}, noReply: 0, unsent: 0, missing: 0 };
  for (const answer of answers) {
    switch (answer.kind) {
      case 'accepted':
        tally.accepted += 1;
        break;
      case 'rejected':
        tally.rejected[answer.code] = (tally.rejected[answer.code] ?? 0) + 1;
        break;
      case 'no_reply':
        tally.noReply += 1;
        break;
      case 'unsent':
        tally.unsent += 1;
        break;
    }
  }
  tally.missing = Math.max(0, planned - answers.length);
  return tally;
}

/** 表の1行。#41 の記録（docs/rehearsal）にそのまま貼れる並びにする */
export interface ReportRow {
  label: string;
  target: string;
  result: string;
  passed: boolean;
}

const ms = (value: number) => `${Math.round(value)} ms`;

function latencyRow(label: string, targetMs: number, summary: LatencySummary): ReportRow {
  const target = `全員に届き、最大 ${ms(targetMs)} 以内`;
  const counted = `${summary.count} / ${summary.expected} 件`;
  if (summary.max === null || summary.p95 === null) {
    return { label, target, result: `測れなかった（${counted}）`, passed: false };
  }
  return {
    label,
    target,
    result: `p95 ${ms(summary.p95)}・最大 ${ms(summary.max)}（${counted}）`,
    // 届かなかったボットがいたら、時間が短くても満たしていない
    passed: summary.count === summary.expected && summary.max <= targetMs,
  };
}

function answerRow(tally: AnswerTally): ReportRow {
  const lost = [
    ...Object.entries(tally.rejected).map(([code, count]) => `${code} ${count}`),
    ...(tally.noReply > 0 ? [`返事なし ${tally.noReply}`] : []),
    ...(tally.unsent > 0 ? [`送れず ${tally.unsent}`] : []),
    ...(tally.missing > 0 ? [`答えず ${tally.missing}`] : []),
  ];
  const result = `${tally.accepted} / ${tally.planned} 件を受理` + (lost.length > 0 ? `（${lost.join('・')}）` : '');
  return {
    label: 'P3 回答の取りこぼし',
    target: '予定した回答がすべて受理される',
    result,
    passed: tally.accepted === tally.planned,
  };
}

export function buildReport(metrics: RunMetrics): ReportRow[] {
  const latencyRows = LATENCY_TARGETS.map(({ kind, label, targetMs }) => {
    const { samples, expected } = metrics.latencies[kind];
    return latencyRow(label, targetMs, summarizeLatency(samples, expected));
  });
  return [...latencyRows, answerRow(tallyAnswers(metrics.plannedAnswers, metrics.answers))];
}

/** Markdown の表にする。セルの | は表を崩すので逃がす */
export function formatMarkdownTable(rows: readonly ReportRow[]): string {
  const cell = (text: string) => text.replaceAll('|', '\\|');
  const lines = [
    '| 測ったもの | 目標 | 結果 | 満たしたか |',
    '| --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${[row.label, row.target, row.result, row.passed ? '満たした' : '満たしていない'].map(cell).join(' | ')} |`,
    ),
  ];
  return lines.join('\n');
}
