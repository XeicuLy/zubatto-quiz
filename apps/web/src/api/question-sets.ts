import { queryOptions } from '@tanstack/react-query';
import {
  createQuestionSetResponseSchema,
  listQuestionSetsResponseSchema,
  questionSetDetailSchema,
  type QuestionSetDetail,
  type QuestionSetInput,
  type QuestionSetSummary,
} from '@zubatto-quiz/protocol';

import { ApiError } from './errors';
import { request } from './request';

/**
 * 問題セットの HTTP API（/api/question-sets）を呼ぶ（F4・F7）。
 * 要求と応答の形は protocol の http/question-sets.ts にある
 */

export async function fetchQuestionSets(): Promise<QuestionSetSummary[]> {
  const response = await request('GET', '/api/question-sets');
  return listQuestionSetsResponseSchema.parse(await response.json()).questionSets;
}

/**
 * 4xx はやり直しても同じ答えなので、やり直さない。ログインが切れた（401）ことを、待たせずに知らせる。
 * 通信の失敗と 5xx は、TanStack Query の既定と同じく3回までやり直す
 */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 3;
}

export const questionSetsQueryOptions = queryOptions({
  queryKey: ['question-sets'],
  queryFn: fetchQuestionSets,
  retry: retryUnlessClientError,
});

/** 正解を含む問題セットの全体（S2: ホストの編集画面だけが読む） */
export async function fetchQuestionSet(id: string): Promise<QuestionSetDetail> {
  const response = await request('GET', `/api/question-sets/${encodeURIComponent(id)}`);
  return questionSetDetailSchema.parse(await response.json());
}

/**
 * 編集画面の loader で読む。キーが一覧の ['question-sets'] で始まるので、一覧を読み直すときは、こちらも古い扱いになる。
 * staleTime は既定の0のままにし、開くたびに読み直す。別のタブで保存した内容を、古い値のまま編集し始めないため
 */
export const questionSetQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['question-sets', id],
    queryFn: () => fetchQuestionSet(id),
    retry: retryUnlessClientError,
  });

/** 問題セットを丸ごと書き換える。送る前に、画面で同じ questionSetSchema に通しておく */
export async function saveQuestionSet(id: string, input: QuestionSetInput): Promise<void> {
  await request('PUT', `/api/question-sets/${encodeURIComponent(id)}`, input);
}

/**
 * 問題セットを作り、新しいセットの ID を返す。編集画面（/admin/sets/new）で書いた内容を、最初に保存するときに呼ぶ。
 * サーバーは空のセットを受け付けないので、空の下書きは画面の中だけで持ち、ここへは questionSetSchema に通した値だけを渡す
 */
export async function createQuestionSet(input: QuestionSetInput): Promise<string> {
  const response = await request('POST', '/api/question-sets', input);
  return createQuestionSetResponseSchema.parse(await response.json()).id;
}

export async function deleteQuestionSet(id: string): Promise<void> {
  await request('DELETE', `/api/question-sets/${encodeURIComponent(id)}`);
}
