import { env, exports } from 'cloudflare:workers';
import { count, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { allowGithubUser, createTestAuth, insertGithubUser } from '../../test/auth/create-test-auth';
import { createDb } from '../db';
import { account, hostAllowlist, session, user } from '../db/schema';
import { createAuthOptions, HOST_NOT_ALLOWED } from './create-auth';

const db = createDb(env.DB);
const BASE_URL = env.BETTER_AUTH_URL;
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await db.delete(user);
  await db.delete(hostAllowlist);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * GitHub の API への通信を差し替え、githubUserId の人としてログインしたことにする。
 * Better Auth は、トークンの取得・ユーザー情報・メールアドレスの3つを GitHub に問い合わせる。
 */
function mockGithub(githubUserId: number) {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new Request(input).url;
    if (url === 'https://github.com/login/oauth/access_token') {
      return Response.json({ access_token: 'gho_test', token_type: 'bearer', scope: 'read:user,user:email' });
    }
    if (url === 'https://api.github.com/user') {
      return Response.json({
        id: githubUserId,
        login: `user${githubUserId}`,
        name: null,
        email: null,
        avatar_url: null,
      });
    }
    if (url === 'https://api.github.com/user/emails') {
      return Response.json([{ email: `user${githubUserId}@example.com`, primary: true, verified: true }]);
    }
    return realFetch(input, init);
  });
}

/** Set-Cookie の名前と値だけを、次の要求の Cookie ヘッダーの形にする */
const toCookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

/**
 * ブラウザが行う GitHub のログインの流れを、画面の Worker の URL で通す。
 * 1. /api/auth/sign-in/social で GitHub への URL と state の Cookie を受け取る
 * 2. GitHub から戻ってきたことにして、state と Cookie を付けて /api/auth/callback/github を開く
 */
async function signInWithGithub() {
  const signIn = await exports.default.fetch(`${BASE_URL}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE_URL },
    body: JSON.stringify({ provider: 'github', callbackURL: '/host' }),
  });
  expect(signIn.status).toBe(200);
  const { url } = await signIn.json<{ url: string }>();
  const state = new URL(url).searchParams.get('state');

  const callback = await exports.default.fetch(`${BASE_URL}/api/auth/callback/github?code=test-code&state=${state}`, {
    headers: { cookie: toCookieHeader(signIn) },
    redirect: 'manual',
  });
  return { signIn, callback };
}

const sessionCookieOf = (response: Response) =>
  response.headers.getSetCookie().find((cookie) => cookie.startsWith('better-auth.session_token='));

const countSessions = async () => (await db.select({ n: count() }).from(session).get())?.n;

describe('GitHub のログイン（S1・ADR 0003）', () => {
  it('許可リストの外の GitHub ユーザーは登録できず、user の行も残らない', async () => {
    mockGithub(2001);

    const { callback } = await signInWithGithub();

    expect(callback.status).toBe(302);
    expect(new URL(callback.headers.get('location')!, BASE_URL).searchParams.get('error')).toBe(HOST_NOT_ALLOWED);
    expect(sessionCookieOf(callback)).toBeUndefined();
    expect(await db.select().from(user)).toEqual([]);
    expect(await countSessions()).toBe(0);
  });

  it('許可リストにある GitHub ユーザーは登録でき、GitHub の ID が account に入る', async () => {
    await allowGithubUser(db, '1001');
    mockGithub(1001);

    const { callback } = await signInWithGithub();

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/host');
    expect(sessionCookieOf(callback)).toBeDefined();
    const accounts = await db.select().from(account);
    expect(accounts).toEqual([expect.objectContaining({ providerId: 'github', accountId: '1001' })]);
  });

  it('許可リストから外したホストは、次のログインで拒否される', async () => {
    await allowGithubUser(db, '1001');
    mockGithub(1001);
    await signInWithGithub();
    expect(await countSessions()).toBe(1);

    await db.delete(hostAllowlist).where(eq(hostAllowlist.githubUserId, '1001'));
    const { callback } = await signInWithGithub();

    expect(new URL(callback.headers.get('location')!, BASE_URL).searchParams.get('error')).toBe(HOST_NOT_ALLOWED);
    expect(sessionCookieOf(callback)).toBeUndefined();
    expect(await countSessions()).toBe(1);
  });
});

describe('GitHub のトークンの保存', () => {
  it('GitHub のアクセストークンを平文で D1 に残さない', async () => {
    await allowGithubUser(db, '1001');
    mockGithub(1001);

    await signInWithGithub();

    const [saved] = await db.select().from(account);
    expect(saved!.accessToken).toBeTruthy();
    expect(saved!.accessToken).not.toContain('gho_test');
  });
});

describe('セッションの作成（databaseHooks の session.create.before）', () => {
  it('許可リストにあるホストにはセッションを作る', async () => {
    await insertGithubUser(db, { userId: 'alice', githubUserId: '1001' });
    await allowGithubUser(db, '1001');
    const { test } = await createTestAuth(env);

    const { session: created } = await test.login({ userId: 'alice' });

    expect(created.userId).toBe('alice');
  });

  it('許可リストから外したホストには、GitHub を通さない経路でもセッションを作らない', async () => {
    await insertGithubUser(db, { userId: 'alice', githubUserId: '1001' });
    const { test } = await createTestAuth(env);

    await expect(test.login({ userId: 'alice' })).rejects.toMatchObject({ body: { code: HOST_NOT_ALLOWED } });
    expect(await countSessions()).toBe(0);
  });
});

describe('ログインの有効期限（ADR 0003）', () => {
  it('セッションは7日で切れ、使っていれば1日ごとに延びる', async () => {
    await allowGithubUser(db, '1001');
    mockGithub(1001);
    const before = Date.now();

    await signInWithGithub();

    const [created] = await db.select().from(session);
    expect(created!.expiresAt.getTime() - before).toBeGreaterThanOrEqual(7 * DAY_MS - 1000);
    expect(created!.expiresAt.getTime() - before).toBeLessThanOrEqual(7 * DAY_MS + 60_000);
    // 延長の間隔は、時間を進めないと振る舞いで確かめられないので、設定の値で確かめる
    expect(createAuthOptions(env).session.updateAge).toBe(24 * 60 * 60);
  });
});

describe('Cookie の属性（ADR 0003）', () => {
  it('state の Cookie とログイン Cookie は HttpOnly・SameSite=Lax で、http の baseURL では Secure が付かない', async () => {
    await allowGithubUser(db, '1001');
    mockGithub(1001);

    const { signIn, callback } = await signInWithGithub();

    const cookies = [...signIn.headers.getSetCookie(), ...callback.headers.getSetCookie()];
    expect(cookies.map((cookie) => cookie.split('=')[0])).toEqual(
      expect.arrayContaining(['better-auth.state', 'better-auth.session_token']),
    );
    for (const cookie of cookies) {
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*SameSite=Lax/i);
      expect(cookie).not.toMatch(/;\s*Secure/i);
    }
  });
});
