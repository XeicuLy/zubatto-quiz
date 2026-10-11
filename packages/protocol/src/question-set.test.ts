import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMIT_MS, questionSchema, questionSetSchema } from './question-set.ts';

const validQuestion = {
  text: '去年の忘年会で、部長が二次会で最初に歌った曲のジャンルは？',
  choices: ['演歌', 'アニソン', '洋楽ロック', '歌っていない'],
  correctIndex: 1,
  limitMs: 10_000,
};

describe('questionSchema', () => {
  it('2〜4択の問題を受け付ける', () => {
    expect(questionSchema.safeParse(validQuestion).success).toBe(true);
    expect(questionSchema.safeParse({ ...validQuestion, choices: ['越せた', '枯れた'], correctIndex: 0 }).success).toBe(
      true,
    );
  });

  it('選択肢が1つ以下、または5つ以上の問題を拒む', () => {
    expect(questionSchema.safeParse({ ...validQuestion, choices: ['演歌'], correctIndex: 0 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...validQuestion, choices: ['1', '2', '3', '4', '5'] }).success).toBe(false);
  });

  it('正解の番号が選択肢の数を超える問題を拒む', () => {
    expect(questionSchema.safeParse({ ...validQuestion, choices: ['越せた', '枯れた'], correctIndex: 2 }).success).toBe(
      false,
    );
    expect(questionSchema.safeParse({ ...validQuestion, correctIndex: -1 }).success).toBe(false);
  });

  it('制限時間は5〜60秒の1秒単位だけを受け付ける（F9）', () => {
    expect(questionSchema.safeParse({ ...validQuestion, limitMs: 5_000 }).success).toBe(true);
    expect(questionSchema.safeParse({ ...validQuestion, limitMs: 60_000 }).success).toBe(true);
    expect(questionSchema.safeParse({ ...validQuestion, limitMs: 4_000 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...validQuestion, limitMs: 61_000 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...validQuestion, limitMs: 10_500 }).success).toBe(false);
  });

  it('制限時間を省くと10秒にする（F9 の初期値）', () => {
    const { limitMs: _, ...withoutLimit } = validQuestion;
    expect(questionSchema.parse(withoutLimit).limitMs).toBe(DEFAULT_LIMIT_MS);
    expect(DEFAULT_LIMIT_MS).toBe(10_000);
  });

  it('空白だけの問題文や選択肢を拒む', () => {
    expect(questionSchema.safeParse({ ...validQuestion, text: '   ' }).success).toBe(false);
    expect(questionSchema.safeParse({ ...validQuestion, choices: ['演歌', ' '] }).success).toBe(false);
  });
});

describe('questionSetSchema', () => {
  it('タイトルと1問以上の問題を持つ', () => {
    expect(questionSetSchema.safeParse({ title: '内輪クイズ', questions: [validQuestion] }).success).toBe(true);
    expect(questionSetSchema.safeParse({ title: '内輪クイズ', questions: [] }).success).toBe(false);
    expect(questionSetSchema.safeParse({ title: '', questions: [validQuestion] }).success).toBe(false);
  });
});
