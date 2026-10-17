import { questionSetSchema, type QuestionSetDetail, type QuestionSetSummary } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { stubFakeApi } from '../../../test/fake-api';
import {
  ApiError,
  createDraftQuestionSet,
  createRoom,
  deleteQuestionSet,
  DRAFT_QUESTION_SET,
  fetchQuestionSet,
  fetchQuestionSets,
  saveQuestionSet,
} from './api';

const set: QuestionSetSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '内輪クイズ',
  questionCount: 10,
  updatedAt: '2026-12-01T03:00:00.000Z',
};

describe('fetchQuestionSets', () => {
  it('自分の問題セットの一覧を返す（F7）', async () => {
    stubFakeApi({ questionSets: [set] });

    expect(await fetchQuestionSets()).toEqual([set]);
  });

  it('ログインが切れていたら、401 の ApiError を投げる', async () => {
    stubFakeApi({ hostName: null });

    await expect(fetchQuestionSets()).rejects.toEqual(new ApiError(401));
  });
});

describe('createDraftQuestionSet', () => {
  it('下書きを保存し、新しいセットの ID を返す', async () => {
    const api = stubFakeApi();

    const id = await createDraftQuestionSet();

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(api.requestsTo('POST', '/api/question-sets')).toEqual([
      expect.objectContaining({ body: DRAFT_QUESTION_SET }),
    ]);
  });

  it('下書きは、API が受け付ける問題セットの形になっている', () => {
    expect(questionSetSchema.safeParse(DRAFT_QUESTION_SET).success).toBe(true);
  });
});

describe('deleteQuestionSet', () => {
  it('その問題セットを消す', async () => {
    const api = stubFakeApi({ questionSets: [set] });

    await deleteQuestionSet(set.id);

    expect(api.requestsTo('DELETE', `/api/question-sets/${set.id}`)).toHaveLength(1);
    expect(await fetchQuestionSets()).toEqual([]);
  });

  it('ない問題セットなら、404 の ApiError を投げる', async () => {
    stubFakeApi();

    await expect(deleteQuestionSet(set.id)).rejects.toEqual(new ApiError(404));
  });
});

const detail: QuestionSetDetail = {
  id: '22222222-2222-4222-8222-222222222222',
  title: '新人歓迎会クイズ',
  questions: [{ text: '部長の十八番は？', choices: ['演歌', 'アニソン'], correctIndex: 1, limitMs: 10_000 }],
};

describe('fetchQuestionSet', () => {
  it('正解を含む問題セットの全体を返す（F7）', async () => {
    stubFakeApi({ questionSetDetails: [detail] });

    expect(await fetchQuestionSet(detail.id)).toEqual(detail);
  });

  it('ない（または他人の）問題セットなら、404 の ApiError を投げる', async () => {
    stubFakeApi();

    await expect(fetchQuestionSet(detail.id)).rejects.toEqual(new ApiError(404));
  });
});

describe('saveQuestionSet', () => {
  it('問題セットを書き換え、読み直すと同じ内容になる（F7）', async () => {
    const api = stubFakeApi({ questionSetDetails: [detail] });
    const input = {
      title: '書き換えた名前',
      questions: [{ text: '新しい問題', choices: ['A', 'B', 'C'], correctIndex: 2, limitMs: 30_000 }],
    };

    await saveQuestionSet(detail.id, input);

    expect(api.requestsTo('PUT', `/api/question-sets/${detail.id}`)).toEqual([
      expect.objectContaining({ body: input }),
    ]);
    expect(await fetchQuestionSet(detail.id)).toEqual({ id: detail.id, ...input });
  });

  it('ない（または他人の）問題セットなら、404 の ApiError を投げる', async () => {
    stubFakeApi();

    await expect(saveQuestionSet(detail.id, detail)).rejects.toEqual(new ApiError(404));
  });
});

describe('createRoom', () => {
  it('問題セットから部屋を作り、部屋の ID と参加用の URL を返す（F1）', async () => {
    const api = stubFakeApi({ questionSets: [set] });

    const room = await createRoom(set.id);

    expect(room).toEqual({ roomId: expect.stringMatching(/^[0-9a-f]{64}$/), joinUrl: expect.any(String) });
    expect(api.requestsTo('POST', '/api/rooms')).toEqual([
      expect.objectContaining({ body: { questionSetId: set.id } }),
    ]);
  });

  it('ない（または他人の）問題セットなら、404 の ApiError を投げる', async () => {
    stubFakeApi();

    await expect(createRoom(set.id)).rejects.toEqual(new ApiError(404));
  });
});
