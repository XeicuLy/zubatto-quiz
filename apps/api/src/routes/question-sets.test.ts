import {
  DEFAULT_LIMIT_MS,
  type CreateQuestionSetResponse,
  type ListQuestionSetsResponse,
  type QuestionSetDetail,
  type QuestionSetInput,
} from '@zubatto-quiz/protocol';
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { allowGithubUser, createTestAuth, insertGithubUser } from '../../test/auth/create-test-auth';
import { createDb } from '../db';
import { hostAllowlist, user } from '../db/schema';

// vitest-plugin はテストごとには D1 を戻さないので、テストの前に空にする（user を消すと問題セットと問題も消える）
const db = createDb(env.DB);

// 2人のホスト。alice が自分のセットを扱い、mallory が alice のセットに手を出そうとする（S1・ADR 0002）
beforeEach(async () => {
  await db.delete(user);
  await db.delete(hostAllowlist);
  for (const [userId, githubUserId] of [
    ['alice', '1001'],
    ['mallory', '1002'],
  ]) {
    await insertGithubUser(db, { userId, githubUserId });
    await allowGithubUser(db, githubUserId);
  }
});

/** userId のホストのログイン Cookie を作る */
async function loginAs(userId: string): Promise<Headers> {
  const { test } = await createTestAuth(env);
  return test.getAuthHeaders({ userId });
}

// 画面の Worker のオリジン（vitest.config.ts の BETTER_AUTH_URL）。転送された要求の URL は、このオリジンになる
const ORIGIN = 'http://localhost:5173';

/** API の Worker へ、画面の Worker から転送されたのと同じ形で要求を送る */
const request = (path: string, init?: RequestInit) => exports.default.fetch(`${ORIGIN}/api/question-sets${path}`, init);

/**
 * userId のホストとして、同じオリジンの画面から要求を送る。body は JSON にして送る。
 * ブラウザは GET 以外の要求に Origin と Sec-Fetch-Site を付ける。csrf() は Content-Type のない要求（本文のない DELETE）を
 * text/plain として扱うので、これがないと同じオリジンの要求でも断られる
 */
async function requestAs(userId: string, method: string, path: string, body?: unknown) {
  const headers = await loginAs(userId);
  headers.set('origin', ORIGIN);
  headers.set('sec-fetch-site', 'same-origin');
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  return request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** userId のホストとしてセットを作り、id を返す */
async function createAs(userId: string, input: QuestionSetInput): Promise<string> {
  const response = await requestAs(userId, 'POST', '', input);
  expect(response.status).toBe(201);
  const { id } = await response.json<CreateQuestionSetResponse>();
  return id;
}

const input = {
  title: '忘年会クイズ',
  questions: [
    { text: '社長の好物は？', choices: ['寿司', '焼肉', 'カレー'], correctIndex: 2, limitMs: 10_000 },
    { text: '会社の創立は何年？', choices: ['1999', '2005'], correctIndex: 0, limitMs: 20_000 },
  ],
} satisfies QuestionSetInput;

const SOME_ID = '00000000-0000-4000-8000-000000000000';

describe('ログインしていない人（S1）', () => {
  it.each([
    ['GET', ''],
    ['POST', ''],
    ['GET', `/${SOME_ID}`],
    ['PUT', `/${SOME_ID}`],
    ['DELETE', `/${SOME_ID}`],
  ])('%s %s は 401 を返す', async (method, path) => {
    const response = await request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' || method === 'PUT' ? '{}' : undefined,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('壊れたログイン Cookie なら 401 を返す', async () => {
    const response = await request('', { headers: { cookie: 'better-auth.session_token=forged' } });

    expect(response.status).toBe(401);
  });
});

describe('保存したセットを取り出して再び使う（F7）', () => {
  it('作ったセットを、一覧と取得で取り出せる', async () => {
    const id = await createAs('alice', input);

    const list = await requestAs('alice', 'GET', '');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({
      questionSets: [{ id, title: input.title, questionCount: 2, updatedAt: expect.any(String) }],
    } satisfies ListQuestionSetsResponse);

    const detail = await requestAs('alice', 'GET', `/${id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual({ id, ...input });
  });

  it('PUT で題名と問題を入れ替えると、204 を返し、取得すると新しい中身になる', async () => {
    const id = await createAs('alice', input);
    const next = { title: '新年会クイズ', questions: [input.questions[1]] } satisfies QuestionSetInput;

    const response = await requestAs('alice', 'PUT', `/${id}`, next);

    expect(response.status).toBe(204);
    expect(await (await requestAs('alice', 'GET', `/${id}`)).json()).toEqual({ id, ...next });
  });

  it('DELETE で消すと、204 を返し、一覧から消える', async () => {
    const id = await createAs('alice', input);

    const response = await requestAs('alice', 'DELETE', `/${id}`);

    expect(response.status).toBe(204);
    expect(await (await requestAs('alice', 'GET', '')).json()).toEqual({ questionSets: [] });
  });
});

describe('他人のセット（S1・ADR 0002）', () => {
  it('一覧には自分のセットだけが出る', async () => {
    await createAs('alice', input);

    expect(await (await requestAs('mallory', 'GET', '')).json()).toEqual({ questionSets: [] });
  });

  it.each([
    ['GET', undefined],
    ['PUT', { title: '乗っ取り', questions: [input.questions[0]] }],
    ['DELETE', undefined],
  ])('他人のセットへの %s は、ないセットと同じ 404 を返し、セットは変わらない', async (method, body) => {
    const id = await createAs('alice', input);

    const others = await requestAs('mallory', method, `/${id}`, body);
    const missing = await requestAs('mallory', method, `/${SOME_ID}`, body);

    expect(others.status).toBe(404);
    expect(await others.json()).toEqual({ error: 'not_found' });
    // 状態コードも本文も同じにして、セットがあるかどうかを漏らさない
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });
    expect(await (await requestAs('alice', 'GET', `/${id}`)).json()).toEqual({ id, ...input });
  });
});

describe('入力の検査（F4・F9）', () => {
  const question = input.questions[0];
  const invalidInputs = [
    ['選択肢が1つ', { ...question, choices: ['寿司'], correctIndex: 0 }],
    ['選択肢が5つ', { ...question, choices: ['1', '2', '3', '4', '5'], correctIndex: 0 }],
    ['正解の番号が選択肢の数を超える', { ...question, choices: ['寿司', '焼肉'], correctIndex: 2 }],
  ] as const;

  it.each(invalidInputs)('%s問題を POST すると 400 を返し、セットを作らない', async (_, invalid) => {
    const response = await requestAs('alice', 'POST', '', { ...input, questions: [invalid] });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
    expect(await (await requestAs('alice', 'GET', '')).json()).toEqual({ questionSets: [] });
  });

  it.each(invalidInputs)('%s問題で PUT すると 400 を返し、セットは変わらない', async (_, invalid) => {
    const id = await createAs('alice', input);

    const response = await requestAs('alice', 'PUT', `/${id}`, { ...input, questions: [invalid] });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
    expect(await (await requestAs('alice', 'GET', `/${id}`)).json()).toEqual({ id, ...input });
  });

  it('制限時間を省いた問題は、10秒で保存する', async () => {
    const { limitMs: _, ...withoutLimit } = question;

    const id = await createAs('alice', { ...input, questions: [withoutLimit] });

    const detail = await (await requestAs('alice', 'GET', `/${id}`)).json<QuestionSetDetail>();
    expect(detail.questions[0]?.limitMs).toBe(DEFAULT_LIMIT_MS);
    expect(DEFAULT_LIMIT_MS).toBe(10_000);
  });
});

describe('別のオリジンからのフォームの形の要求（S1・ADR 0003）', () => {
  // HTML のフォームが送れる Content-Type。JSON の要求は別のオリジンから送るとプリフライトが要り、CORS を許さないので届かない
  const formContentTypes = [
    ['application/x-www-form-urlencoded', 'title=x'],
    ['multipart/form-data; boundary=x', '--x--'],
    // 本文は JSON として正しくても、Content-Type が text/plain ならフォームから送れる
    ['text/plain', JSON.stringify(input)],
  ];
  const cases = ['POST', 'PUT', 'DELETE'].flatMap((method) =>
    formContentTypes.map(([contentType, body]) => [method, contentType, body] as const),
  );

  it.each(cases)(
    '%s（%s）は、ログイン Cookie が付いていても 403 を返し、セットを変えない',
    async (method, contentType, body) => {
      const id = await createAs('alice', input);
      const headers = await loginAs('alice');
      headers.set('content-type', contentType);
      headers.set('origin', 'https://evil.example');
      headers.set('sec-fetch-site', 'cross-site');

      const response = await request(method === 'POST' ? '' : `/${id}`, { method, headers, body });

      expect(response.status).toBe(403);
      expect(await (await requestAs('alice', 'GET', '')).json()).toEqual({
        questionSets: [expect.objectContaining({ id, title: input.title })],
      });
    },
  );

  it('同じオリジンからの要求は断らない', async () => {
    const headers = await loginAs('alice');
    headers.set('content-type', 'text/plain');
    headers.set('origin', ORIGIN);
    headers.set('sec-fetch-site', 'same-origin');

    const response = await request('', { method: 'POST', headers, body: JSON.stringify(input) });

    // csrf() は通り、JSON でない本文なので入力の検査で 400 になる
    expect(response.status).toBe(400);
  });
});
