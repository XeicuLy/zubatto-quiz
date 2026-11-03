import { describe, expect, it } from 'vitest';

import { validateResponse, validateServerMessage } from './validate.ts';

const participantId = '0f8fad5b-d9cb-469f-a165-70867728950e';
const questionSetId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const roomId = 'a'.repeat(64);

const questionShown = {
  type: 'questionShown',
  questionId: 'q1',
  questionIndex: 0,
  questionCount: 3,
  text: '日本でいちばん高い山は？',
  limitMs: 10_000,
};

describe('validateServerMessage', () => {
  it.each([
    [
      '参加できた',
      {
        type: 'joined',
        participantId,
        room: { title: '忘れ物', questionCount: 3, phase: 'lobby', questionIndex: null },
      },
    ],
    ['出題', questionShown],
    ['回答の受理', { type: 'answerAccepted', questionId: 'q1', choiceIndex: 2, elapsedMs: 1234 }],
    ['誤り', { type: 'error', code: 'not_accepting' }],
  ])('ws.schema.json に合うメッセージ（%s）は通す', (_, message) => {
    expect(() => validateServerMessage(message)).not.toThrow();
  });

  it.each([
    ['知らない type', { type: 'surprise' }],
    ['必須のキーがない', { type: 'answerAccepted', questionId: 'q1', choiceIndex: 2 }],
    ['範囲の外の数', { type: 'answerAccepted', questionId: 'q1', choiceIndex: 4, elapsedMs: 0 }],
    [
      'uuid でない ID',
      {
        type: 'joined',
        participantId: 'p1',
        room: { title: 't', questionCount: 1, phase: 'lobby', questionIndex: null },
      },
    ],
    // 締切の前に正解の番号が出ていく（S2）と、余分なキーとして捕まる
    ['出題に正解の番号が付いている', { ...questionShown, correctIndex: 1 }],
    ['オブジェクトでない', 'questionShown'],
  ])('ws.schema.json に合わないメッセージ（%s）はエラーにする', (_, message) => {
    expect(() => validateServerMessage(message)).toThrow(/ws\.schema\.json/);
  });

  it('エラーには、type が同じ形と比べて合わないところだけを書く', () => {
    expect(() =>
      validateServerMessage({ type: 'answerAccepted', questionId: 'q1', choiceIndex: 4, elapsedMs: 0 }),
    ).toThrow(/^ws\.schema\.json の answerAccepted\/choiceIndex must be <= 3$/);
    expect(() => validateServerMessage({ type: 'surprise' })).toThrow(
      /type が "surprise" の形は ws\.schema\.json にない/,
    );
  });
});

/** JSON の本文の応答を作る */
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** テキストの本文の応答を作る。Hono の c.text と同じく charset が付く */
const text = (status: number, body: string) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=UTF-8' } });

describe('validateResponse', () => {
  it('openapi.json に合う JSON の応答は通し、読んだ本文を返す', async () => {
    const body = { roomId, joinUrl: `https://zubakui.example/join/${roomId}` };
    await expect(validateResponse('POST /api/rooms', json(201, body))).resolves.toEqual(body);
  });

  it('パスに {id} がある経路も引ける', async () => {
    const body = { error: 'not_found' };
    await expect(validateResponse('GET /api/question-sets/{id}', json(404, body))).resolves.toEqual(body);
  });

  it('components/responses を指す応答（401）もたどって調べる', async () => {
    await expect(validateResponse('GET /api/question-sets', json(401, { error: 'unauthorized' }))).resolves.toEqual({
      error: 'unauthorized',
    });
    await expect(validateResponse('GET /api/question-sets', json(401, { error: 'nope' }))).rejects.toThrow(
      /GET \/api\/question-sets 401/,
    );
  });

  it('テキストで返ると書いた応答（csrf() の 403）は、charset が付いていても通す', async () => {
    await expect(validateResponse('POST /api/question-sets', text(403, 'Forbidden'))).resolves.toBe('Forbidden');
  });

  it('本文がないと書いた応答（204）は、本文が空なら undefined を返す', async () => {
    await expect(
      validateResponse('DELETE /api/question-sets/{id}', new Response(null, { status: 204 })),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['必須のキーがない', 'POST /api/question-sets', json(201, {})],
    ['uuid でない ID', 'POST /api/question-sets', json(201, { id: 'set-1' })],
    // pattern のない format は、ajv-formats がないと素通りする
    ['joinUrl が相対パス', 'POST /api/rooms', json(201, { roomId, joinUrl: `/join/${roomId}` })],
    ['余分なキー', 'POST /api/question-sets', json(201, { id: questionSetId, ownerId: '1' })],
  ])('openapi.json に合わない本文（%s）はエラーにする', async (_, operation, response) => {
    await expect(validateResponse(operation, response)).rejects.toThrow(operation);
  });

  it('JSON と名乗って JSON として読めない本文は、どの応答かを書いたエラーにする', async () => {
    const broken = new Response('{"id":', { status: 201, headers: { 'content-type': 'application/json' } });
    await expect(validateResponse('POST /api/question-sets', broken)).rejects.toThrow(
      /^POST \/api\/question-sets 201 の本文が JSON として読めない/,
    );
  });

  it('書いていない状態コードはエラーにする', async () => {
    await expect(validateResponse('POST /api/rooms', text(500, 'Internal Server Error'))).rejects.toThrow(/500/);
  });

  it('書いていない content-type はエラーにする', async () => {
    const html = new Response('<p>ok</p>', { status: 200, headers: { 'content-type': 'text/html' } });
    await expect(validateResponse('GET /api/question-sets', html)).rejects.toThrow(/text\/html/);
    // JSON で返ると書いた 401 が、テキストで返ってきた
    await expect(validateResponse('GET /api/question-sets', text(401, 'Unauthorized'))).rejects.toThrow(/text\/plain/);
  });

  it.each(['GET /api/rooms', 'PATCH /api/question-sets/{id}', 'GET /api/question-sets/abc', 'POST'])(
    'openapi.json にない経路（%s）はエラーにする',
    async (operation) => {
      await expect(validateResponse(operation, json(200, {}))).rejects.toThrow(/openapi\.json/);
    },
  );
});
