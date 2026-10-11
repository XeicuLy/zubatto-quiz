import { defaultScoring, type ScoringConfig } from './config.ts';

/** 経過時間をそろえる単位（0.01秒、P2） */
const ELAPSED_UNIT_MS = 10;

/**
 * 端末で計った経過時間を、0から制限時間のあいだに収め、0.01秒単位に切り捨てる（式の1）。
 * 表示・得点・ボーナス・最速正解者（F14）のどれにも、この値を使う
 */
export const normalizeElapsedMs = (measuredMs: number, limitMs: number): number => {
  const clamped = Math.min(Math.max(measuredMs, 0), limitMs);
  return Math.floor(clamped / ELAPSED_UNIT_MS) * ELAPSED_UNIT_MS;
};

/**
 * 経過時間を 0.01秒単位の秒の文字列にする（例: 1010 → "1.01"）。「秒」は画面で付ける。
 * 小数の誤差が出ないよう、整数のまま組み立てる
 */
export const formatSeconds = (elapsedMs: number): string => {
  const centiseconds = Math.floor(elapsedMs / ELAPSED_UNIT_MS);
  const seconds = Math.floor(centiseconds / 100);
  const fraction = String(centiseconds % 100).padStart(2, '0');
  return `${seconds}.${fraction}`;
};

export type AnswerToScore = {
  correct: boolean;
  /** 端末で計った経過時間（ミリ秒）。切り捨て前の値でもよい */
  elapsedMs: number;
  /** 制限時間（ミリ秒、F9 の範囲なので0にはならない） */
  limitMs: number;
};

/** 1問の得点（F11・F12）。不正解と未回答は0点（式の2） */
export const scoreAnswer = (answer: AnswerToScore, config: ScoringConfig = defaultScoring): number => {
  if (!answer.correct) return 0;

  const elapsedMs = normalizeElapsedMs(answer.elapsedMs, answer.limitMs);
  // 掛けてから割る。先に割ると小数の誤差で1点ずれる（制限5秒・0.35秒で 465 が 464 になる）
  const speedPoints = Math.floor((config.maxSpeedPoints * (answer.limitMs - elapsedMs)) / answer.limitMs);
  const { quickBonus } = config;
  const bonus = quickBonus !== undefined && elapsedMs <= quickBonus.withinMs ? quickBonus.points : 0;
  return config.basePoints + speedPoints + bonus;
};

/** 1問で取れる最大の点（式の4）。制限時間によらない */
export const maxPointsPerQuestion = (config: ScoringConfig = defaultScoring): number =>
  config.basePoints + config.maxSpeedPoints + (config.quickBonus?.points ?? 0);

/** 回答者画面の「残りの問題で取れる最大の点」（F15） */
export const remainingMaxPoints = (remainingQuestions: number, config: ScoringConfig = defaultScoring): number =>
  remainingQuestions * maxPointsPerQuestion(config);
