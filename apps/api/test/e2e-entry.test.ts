import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '@/db';
import { hostAllowlist, user } from '@/db/schema';

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
async function login(body?: { name?: string; admin?: boolean }): Promise<string> {
  const response = await request(
    E2E_LOGIN_PATH,
    body === undefined
      ? { method: 'POST' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
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

  // 使い方の画像（e2e/guide-screenshots/capture.ts）は、管理画面の右上に写る名前を ID でなくする
  it('名前を渡すと、その名前のホストになる。渡さなければ ID が名前になる', async () => {
    const named = await login({ name: 'ホスト' });
    const unnamed = await login();

    const nameOf = async (cookie: string) => {
      const response = await request('/api/auth/get-session', { headers: { cookie } });
      return (await response.json<{ user: { id: string; name: string } }>()).user;
    };
    expect((await nameOf(named)).name).toBe('ホスト');
    const { id, name } = await nameOf(unnamed);
    expect(name).toBe(id);
  });

  // 管理者の画面（ADR 0013）の E2E は、管理者のホストでログインする
  it('admin: true を渡すと管理者のホストになる。渡さなければ管理者でない', async () => {
    const admin = await login({ admin: true });
    const host = await login();

    const isAdminOf = async (cookie: string) => {
      const response = await request('/api/me', { headers: { cookie } });
      return (await response.json<{ isAdmin: boolean }>()).isAdmin;
    };
    expect(await isAdminOf(admin)).toBe(true);
    expect(await isAdminOf(host)).toBe(false);
  });

  it('本番の経路もそのまま通る', async () => {
    const response = await request('/api/health');

    expect(await response.json()).toEqual({ ok: true });
  });
});
