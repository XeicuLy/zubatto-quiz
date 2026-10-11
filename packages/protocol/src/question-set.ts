import * as z from 'zod';

/** 選択肢の数（F4: 2〜4択） */
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 4;

/** 制限時間（F9: 5〜60秒の1秒単位、初期値10秒）。スコアの計算の式にそろえてミリ秒で持つ */
export const MIN_LIMIT_MS = 5_000;
export const MAX_LIMIT_MS = 60_000;
export const DEFAULT_LIMIT_MS = 10_000;

/** 1つの問題セットに入れられる問題の数 */
export const MAX_QUESTIONS = 100;

export const questionSetTitleSchema = z.string().trim().min(1).max(100);
export const questionTextSchema = z.string().trim().min(1).max(1_000);
export const choiceTextSchema = z.string().trim().min(1).max(100);
export const limitMsSchema = z.int().min(MIN_LIMIT_MS).max(MAX_LIMIT_MS).multipleOf(1_000);

/** 何問目か（0始まり） */
export const questionIndexSchema = z
  .int()
  .min(0)
  .max(MAX_QUESTIONS - 1);

/** 選択肢の番号（0始まり） */
export const choiceIndexSchema = z
  .int()
  .min(0)
  .max(MAX_CHOICES - 1);

/**
 * 正解を含む問題。管理画面・HTTP API・D1・部屋の DO の中だけで使い、回答者の端末へは送らない（S2・ADR 0002）。
 * 回答者へ送る形は ws/server-messages.ts の questionShown・answeringStarted で、正解を持たない。
 */
export const questionSchema = z
  .object({
    /** Markdown（F5）。描画するときに生の HTML を許さない（ADR 0004） */
    text: questionTextSchema,
    choices: z.array(choiceTextSchema).min(MIN_CHOICES).max(MAX_CHOICES),
    correctIndex: choiceIndexSchema,
    limitMs: limitMsSchema.default(DEFAULT_LIMIT_MS),
  })
  // 項目をまたぐ条件は JSON Schema に出ない。Go へ置き換えるときは、この条件も書き写す
  .refine((question) => question.correctIndex < question.choices.length, {
    message: '正解の番号が選択肢の数を超えている',
    path: ['correctIndex'],
  });
export type Question = z.infer<typeof questionSchema>;

export const questionSetSchema = z.object({
  title: questionSetTitleSchema,
  questions: z.array(questionSchema).min(1).max(MAX_QUESTIONS),
});
export type QuestionSet = z.infer<typeof questionSetSchema>;
