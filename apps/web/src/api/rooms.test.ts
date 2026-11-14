import type { QuestionSetSummary } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { stubFakeApi } from '../../test/fake-api';
import { ApiError } from './errors';
import { createRoom } from './rooms';

const set: QuestionSetSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '内輪クイズ',
  questionCount: 10,
  updatedAt: '2026-12-01T03:00:00.000Z',
};

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

    await expect(createRoom(set.id)).rejects.toEqual(new ApiError(404, 'not_found'));
  });
});
