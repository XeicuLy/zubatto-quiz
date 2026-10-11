import { env, exports } from 'cloudflare:workers';

import { createDb } from '../src/db';
import { hostAllowlist, user } from '../src/db/schema';
import { allowGithubUser, createTestAuth, insertGithubUser } from './auth/create-test-auth';

/**
 * D1 を空にして、2人のホストを入れ直す。alice が自分のセットを扱い、mallory が alice のセットに手を出そうとする（S1・ADR 0002）。
 * vitest-plugin はテストごとには D1 を戻さないので、beforeEach で呼ぶ（user を消すと問題セットと問題も消える）
 */
export async function resetHosts(): Promise<void> {
  const db = createDb(env.DB);
  await db.delete(user);
  await db.delete(hostAllowlist);
  for (const [userId, githubUserId] of [
    ['alice', '1001'],
    ['mallory', '1002'],
  ] as const) {
    await insertGithubUser(db, { userId, githubUserId });
    await allowGithubUser(db, githubUserId);
  }
}

/** userId のホストのログイン Cookie を作る */
export async function loginAs(userId: string): Promise<Headers> {
  const { test } = await createTestAuth(env);
  return test.getAuthHeaders({ userId });
}

/** 画面の Worker のオリジン（vitest.config.ts の BETTER_AUTH_URL）。転送された要求の URL は、このオリジンになる */
export const ORIGIN = 'http://localhost:5173';

/** API の Worker へ、画面の Worker から転送されたのと同じ形で要求を送る。path は /api のあとに続ける */
export const apiRequest = (path: string, init?: RequestInit) => exports.default.fetch(`${ORIGIN}/api${path}`, init);

/**
 * userId のホストとして、同じオリジンの画面から要求を送る。body は JSON にして送る。
 * ブラウザは GET 以外の要求に Origin と Sec-Fetch-Site を付ける。csrf() は Content-Type のない要求（本文のない DELETE）を
 * text/plain として扱うので、これがないと同じオリジンの要求でも断られる
 */
export async function apiRequestAs(userId: string, method: string, path: string, body?: unknown) {
  const headers = await loginAs(userId);
  headers.set('origin', ORIGIN);
  headers.set('sec-fetch-site', 'same-origin');
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  return apiRequest(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
