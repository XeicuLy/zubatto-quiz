import {
  createRoomResponseSchema,
  type CreateQuestionSetResponse,
  type CreateRoomResponse,
  type QuestionSetInput,
} from '@zubatto-quiz/protocol';
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { apiRequest, apiRequestAs, loginAs, ORIGIN, resetHosts } from '../../test/host-request';
import { createDb } from '../db';
import { getQuestionSet } from '../question-sets/repository';

beforeEach(resetHosts);

const input = {
  title: '忘年会クイズ',
  questions: [
    { text: '社長の好物は？', choices: ['寿司', '焼肉', 'カレー'], correctIndex: 2, limitMs: 10_000 },
    { text: '会社の創立は何年？', choices: ['1999', '2005'], correctIndex: 0, limitMs: 20_000 },
  ],
} satisfies QuestionSetInput;

const SOME_ID = '00000000-0000-4000-8000-000000000000';

/** userId のホストとして問題セットを作り、id を返す */
async function createSetAs(userId: string, set: QuestionSetInput = input): Promise<string> {
  const response = await apiRequestAs(userId, 'POST', '/question-sets', set);
  expect(response.status).toBe(201);
  return (await response.json<CreateQuestionSetResponse>()).id;
}

/** userId のホストとして部屋を作る */
const createRoomAs = (userId: string, body: unknown) => apiRequestAs(userId, 'POST', '/rooms', body);

/** roomId の部屋の DO に入っている部屋と問題を読む。roomId から DO に戻れることも、ここで確かめる */
const readRoom = (roomId: string) =>
  runInDurableObject(env.ROOM.get(env.ROOM.idFromString(roomId)), (_instance, state) => {
    const { sql } = state.storage;
    return {
      room: sql.exec('SELECT owner_id, title, phase FROM room').toArray(),
      questions: sql
        .exec<{ id: string; text: string; choices: string; correct_index: number; limit_ms: number }>(
          'SELECT id, text, choices, correct_index, limit_ms FROM questions ORDER BY position',
        )
        .toArray()
        .map(({ id, text, choices, correct_index, limit_ms }) => ({
          id,
          text,
          choices: JSON.parse(choices) as string[],
          correctIndex: correct_index,
          limitMs: limit_ms,
        })),
    };
  });

describe('部屋の作成（F1・ADR 0002）', () => {
  it('自分の問題セットから部屋を作ると、201 と部屋の ID と参加用の URL を返す', async () => {
    const setId = await createSetAs('alice');

    const response = await createRoomAs('alice', { questionSetId: setId });

    expect(response.status).toBe(201);
    const body = createRoomResponseSchema.parse(await response.json());
    expect(body.joinUrl).toBe(`${ORIGIN}/r/${body.roomId}`);
  });

  it('部屋の DO に、持ち主と、D1 の問題セットの全体（正解と問題の id を含む）を写す', async () => {
    const setId = await createSetAs('alice');

    const { roomId } = await (await createRoomAs('alice', { questionSetId: setId })).json<CreateRoomResponse>();

    const stored = await getQuestionSet(createDb(env.DB), { ownerId: 'alice', setId });
    expect(await readRoom(roomId)).toEqual({
      room: [{ owner_id: 'alice', title: input.title, phase: 'lobby' }],
      questions: stored?.questions,
    });
  });

  it('部屋の ID は推測できない。同じセットから作っても、毎回ちがう64桁の16進になる（S3）', async () => {
    const setId = await createSetAs('alice');

    const roomIds = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const response = await createRoomAs('alice', { questionSetId: setId });
        return (await response.json<CreateRoomResponse>()).roomId;
      }),
    );

    expect(new Set(roomIds).size).toBe(roomIds.length);
    for (const roomId of roomIds) {
      expect(roomId).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('作ったあとの問題セットの編集（F7・ADR 0002）', () => {
  it('元の問題セットを編集しても消しても、部屋の問題は変わらない。部屋は D1 を読みに行かない', async () => {
    const setId = await createSetAs('alice');
    const { roomId } = await (await createRoomAs('alice', { questionSetId: setId })).json<CreateRoomResponse>();
    const before = await readRoom(roomId);

    const edited = await apiRequestAs('alice', 'PUT', `/question-sets/${setId}`, {
      title: '新年会クイズ',
      questions: [{ text: '今年の目標は？', choices: ['健康', '貯金'], correctIndex: 1, limitMs: 30_000 }],
    } satisfies QuestionSetInput);
    expect(edited.status).toBe(204);
    expect(await readRoom(roomId)).toEqual(before);

    const deleted = await apiRequestAs('alice', 'DELETE', `/question-sets/${setId}`);
    expect(deleted.status).toBe(204);
    expect(await readRoom(roomId)).toEqual(before);
  });
});

describe('作れない要求', () => {
  it('ログインしていなければ 401 を返す（S1）', async () => {
    const response = await apiRequest('/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionSetId: SOME_ID }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('他人のセットからは作れず、ないセットと同じ 404 を返す（S1・ADR 0002）', async () => {
    const aliceSetId = await createSetAs('alice');

    const others = await createRoomAs('mallory', { questionSetId: aliceSetId });
    const missing = await createRoomAs('mallory', { questionSetId: SOME_ID });

    expect(others.status).toBe(404);
    expect(await others.json()).toEqual({ error: 'not_found' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });
  });

  it.each([
    ['questionSetId がない', {}],
    ['questionSetId が UUID でない', { questionSetId: 'not-a-uuid' }],
  ])('%s本文には 400 を返す', async (_, body) => {
    const response = await createRoomAs('alice', body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
  });

  it('別のオリジンからのフォームの形の要求は、ログイン Cookie が付いていても 403 を返す（ADR 0003）', async () => {
    const setId = await createSetAs('alice');
    const headers = await loginAs('alice');
    headers.set('content-type', 'text/plain');
    headers.set('origin', 'https://evil.example');
    headers.set('sec-fetch-site', 'cross-site');

    const response = await apiRequest('/rooms', {
      method: 'POST',
      headers,
      body: JSON.stringify({ questionSetId: setId }),
    });

    expect(response.status).toBe(403);
  });
});
