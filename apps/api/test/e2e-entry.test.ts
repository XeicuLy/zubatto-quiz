import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '../src/db';
import { hostAllowlist, user } from '../src/db/schema';
import e2e from './e2e-entry';
import { E2E_LOGIN_PATH } from './e2e-login-path';

const db = createDb(env.DB);
const ORIGIN = env.BETTER_AUTH_URL;

beforeEach(async () => {
  await db.delete(user);
  await db.delete(hostAllowlist);
});

const request = (path: string, init?: RequestInit) => e2e.request(`${ORIGIN}${path}`, init, env);

/** E2E 用のログインを呼び、返ってきた Cookie を、ブラウザが付けるのと同じ Cookie ヘッダーにする */
async function login(): Promise<string> {
  const response = await request(E2E_LOGIN_PATH, { method: 'POST' });
  expect(response.status).toBe(200);
  const { cookies } = await response.json<{ cookies: { name: string; value: string }[] }>();
  return cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
}

describe('E2E 用のログインの入口（ADR 0003）', () => {
  it('返した Cookie で、本番と同じ API にホストとして入れる', async () => {
    const cookie = await login();

    const response = await request('/api/question-sets', { headers: { cookie } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ questionSets: [] });
  });

  it('呼ぶたびに別のホストになり、ほかの回の問題セットは見えない', async () => {
    const first = await login();
    const created = await request('/api/question-sets', {
      method: 'POST',
      headers: { cookie: first, 'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ title: '前の回', questions: [{ text: 'Q', choices: ['A', 'B'], correctIndex: 0 }] }),
    });
    expect(created.status).toBe(201);

    const second = await login();
    const response = await request('/api/question-sets', { headers: { cookie: second } });

    expect(await response.json()).toEqual({ questionSets: [] });
  });

  it('本番の経路もそのまま通る', async () => {
    const response = await request('/api/health');

    expect(await response.json()).toEqual({ ok: true });
  });
});
