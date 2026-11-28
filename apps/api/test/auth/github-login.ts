import { env, exports } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { expect, vi } from 'vitest';

import type { Db } from '@/db';
import { account, session, user } from '@/db/schema';

const BASE_URL = env.BETTER_AUTH_URL;

/**
 * GitHub の API への通信を差し替え、githubUserId の人としてログインしたことにする。
 * Better Auth は、トークンの取得・ユーザー情報・メールアドレスの3つを GitHub に問い合わせる。
 * 保存しないことを確かめるため、本名・email・アバター・トークン・scope には本物らしい値を返す。
 * scope は、前に `user:email` を許可した人に GitHub が返す形にする（ADR 0016）。
 * emailsStatus を 403 にすると、scope の無いトークンで `/user/emails` が断られたことにする
 */
export function mockGithub(
  githubUserId: number,
  { email = `user${githubUserId}@example.com`, emailsStatus = 200 }: { email?: string; emailsStatus?: 200 | 403 } = {},
) {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new Request(input).url;
    if (url === 'https://github.com/login/oauth/access_token') {
      return Response.json({
        access_token: 'gho_test',
        refresh_token: 'ghr_test',
        token_type: 'bearer',
        scope: 'read:user,user:email',
      });
    }
    if (url === 'https://api.github.com/user') {
      return Response.json({
        id: githubUserId,
        login: `user${githubUserId}`,
        name: '山田 太郎',
        email,
        avatar_url: `https://avatars.githubusercontent.com/u/${githubUserId}?v=4`,
      });
    }
    if (url === 'https://api.github.com/user/emails') {
      return emailsStatus === 200
        ? Response.json([{ email, primary: true, verified: true }])
        : Response.json({ message: 'Requires authentication' }, { status: 403 });
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

/** ブラウザから届く User-Agent と、Better Auth が既定で IP を読むヘッダー。保存されないことを確かめる */
const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15',
  'x-forwarded-for': '203.0.113.7',
};

/**
 * ブラウザが行う GitHub のログインの流れを、画面の Worker の URL で通す。
 * 1. /api/auth/sign-in/social で GitHub への URL と state の Cookie を受け取る
 * 2. GitHub から戻ってきたことにして、state と Cookie を付けて /api/auth/callback/github を開く
 */
export async function signInWithGithub() {
  const signIn = await exports.default.fetch(`${BASE_URL}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE_URL, ...BROWSER_HEADERS },
    // 画面（apps/web の auth-client.ts）と同じく、拒否されたらログイン画面へ戻すよう頼む
    body: JSON.stringify({ provider: 'github', callbackURL: '/host', errorCallbackURL: '/login' }),
  });
  expect(signIn.status).toBe(200);
  const { url } = await signIn.json<{ url: string }>();
  const state = new URL(url).searchParams.get('state');

  const callback = await exports.default.fetch(`${BASE_URL}/api/auth/callback/github?code=test-code&state=${state}`, {
    headers: { cookie: toCookieHeader(signIn), ...BROWSER_HEADERS },
    redirect: 'manual',
  });
  return { signIn, callback, authorizationUrl: new URL(url) };
}

export const sessionCookieOf = (response: Response) =>
  response.headers.getSetCookie().find((cookie) => cookie.startsWith('better-auth.session_token='));

/**
 * githubUserId の人の user・account・session の行が、保存の規則（host-data-policy.ts）どおりの値だけを持つことを確かめる。
 * GitHub やブラウザから届いた本物の email・アバター・トークン・scope・IP・User-Agent が残っていれば落ちる。
 * name はここでは見ない。ログインでは login が入り（create-auth.test.ts）、前からある行は手順書で1人ずつ直す（docs/runbooks/host-data.md）
 */
export async function expectStoredByPolicy(db: Db, githubUserId: number) {
  const [savedAccount] = await db
    .select()
    .from(account)
    .where(eq(account.accountId, String(githubUserId)));
  expect(savedAccount).toMatchObject({
    accessToken: null,
    refreshToken: null,
    idToken: null,
    scope: null,
  });
  const savedUser = await db.select().from(user).where(eq(user.id, savedAccount!.userId)).get();
  expect(savedUser).toMatchObject({
    email: `${githubUserId}@users.zubakui.invalid`,
    emailVerified: false,
    image: null,
  });
  const sessions = await db.select().from(session).where(eq(session.userId, savedAccount!.userId));
  expect(sessions.length).toBeGreaterThan(0);
  for (const saved of sessions) {
    expect(saved).toMatchObject({ ipAddress: null, userAgent: null });
  }
}
