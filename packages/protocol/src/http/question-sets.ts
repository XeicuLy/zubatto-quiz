import * as z from 'zod';

import { questionSetSchema, questionSetTitleSchema } from '../question-set.ts';

/**
 * 問題セットを管理する HTTP API（/api/question-sets）の要求と応答の形（F4・F7）。ホストだけが使える（S1）。
 *
 * - GET    /api/question-sets      → 200 ListQuestionSetsResponse
 * - POST   /api/question-sets      QuestionSetInput → 201 CreateQuestionSetResponse
 * - GET    /api/question-sets/:id  → 200 QuestionSetDetail
 * - PUT    /api/question-sets/:id  QuestionSetInput → 204
 * - DELETE /api/question-sets/:id  → 204
 *
 * エラーは http/errors.ts の形で返す。他人のセットは、ないセットと同じ 404 にする
 */

/** 作成と更新の本文。questionSetSchema で確かめる。limitMs は省けて、省くと10秒になる（F9） */
export type QuestionSetInput = z.input<typeof questionSetSchema>;

/** 一覧の1行。問題の中身（正解を含む）は持たない */
export const questionSetSummarySchema = z.object({
  id: z.uuid(),
  title: questionSetTitleSchema,
  questionCount: z.int().min(0),
  updatedAt: z.iso.datetime(),
});
export type QuestionSetSummary = z.infer<typeof questionSetSummarySchema>;

/** 更新の新しい順に並べる */
export const listQuestionSetsResponseSchema = z.object({ questionSets: z.array(questionSetSummarySchema) });
export type ListQuestionSetsResponse = z.infer<typeof listQuestionSetsResponseSchema>;

export const createQuestionSetResponseSchema = z.object({ id: z.uuid() });
export type CreateQuestionSetResponse = z.infer<typeof createQuestionSetResponseSchema>;

/** 正解を含むセットの全体。ホストの編集画面だけが受け取る（S2） */
export const questionSetDetailSchema = questionSetSchema.extend({ id: z.uuid() });
export type QuestionSetDetail = z.output<typeof questionSetDetailSchema>;
