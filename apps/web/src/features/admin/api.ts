import { queryOptions } from '@tanstack/react-query';
import {
  createQuestionSetResponseSchema,
  listQuestionSetsResponseSchema,
  questionSetDetailSchema,
  type QuestionSetDetail,
  type QuestionSetInput,
  type QuestionSetSummary,
} from '@zubatto-quiz/protocol';

/**
 * 問題セットの HTTP API（/api/question-sets）を呼ぶ（F4・F7）。要求と応答の形は protocol の http/question-sets.ts にある。
 * Hono の RPC ではなく protocol のスキーマで読むので、画面は API の実装（Hono）に依存しない（ADR 0001）。
 *
 * Cookie は同じオリジンなので fetch が自動で付ける。csrf() は Origin と Sec-Fetch-Site で通す（ADR 0003・0006）
 */

/** API が 2xx 以外を返した。401 はログインが切れた、404 はない（または他人の）セット */
export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API が ${status} を返した`);
    this.name = 'ApiError';
  }
}

async function request(method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new ApiError(response.status);
  }
  return response;
}

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
 * 「問題セットを作る」で保存する下書き。問題セットは1問以上ないと保存できないので、仮の1問を入れる。
 * 中身は、作ったあとに移る編集画面（T30）で書き換える
 */
export const DRAFT_QUESTION_SET = {
  title: '新しい問題セット',
  questions: [{ text: '問題文を入れてください', choices: ['選択肢1', '選択肢2'], correctIndex: 0 }],
} satisfies QuestionSetInput;

/** 下書きを保存し、新しいセットの ID を返す */
export async function createDraftQuestionSet(): Promise<string> {
  const response = await request('POST', '/api/question-sets', DRAFT_QUESTION_SET);
  return createQuestionSetResponseSchema.parse(await response.json()).id;
}

export async function deleteQuestionSet(id: string): Promise<void> {
  await request('DELETE', `/api/question-sets/${encodeURIComponent(id)}`);
}
