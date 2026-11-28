import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDb } from '@/db';
import { account, hostAllowlist, session, user } from '@/db/schema';

import { allowGithubUser, insertGithubUser } from '../test/auth/create-test-auth';
import { expectStoredByPolicy, mockGithub, sessionCookieOf, signInWithGithub } from '../test/auth/github-login';
import { CHECK_SQL, SCRUB_STATEMENTS } from './scrub-host-data';

const db = createDb(env.DB);
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await db.delete(user);
  await db.delete(hostAllowlist);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * #345 より前のログインが残した形の行を入れる。Better Auth の既定のまま、GitHub とブラウザから届いた値が入っている。
 * セッションは2つ（2回ログインした）にして、どの行も書き換わることを確かめる
 */
async function insertOldHost({ userId, githubUserId }: { userId: string; githubUserId: string }) {
  await db.insert(user).values({
    id: userId,
    name: '山田 太郎',
    email: `taro${githubUserId}@example.com`,
    emailVerified: true,
    image: `https://avatars.githubusercontent.com/u/${githubUserId}?v=4`,
  });
  await db.insert(account).values({
    id: `${userId}-github`,
    userId,
    providerId: 'github',
    accountId: githubUserId,
    accessToken: 'encrypted-gho',
    refreshToken: 'encrypted-ghr',
    idToken: 'encrypted-id',
    scope: 'read:user,user:email',
  });
  for (const n of [1, 2]) {
    await db.insert(session).values({
      id: `${userId}-session-${n}`,
      userId,
      token: `${userId}-token-${n}`,
      expiresAt: new Date(Date.now() + DAY_MS),
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15',
    });
  }
}

/** 手順書の「確かめる」: 書き換える行の数を、表ごとに数える */
const check = () => env.DB.prepare(CHECK_SQL).first();

/** 手順書の「書き換える」: 文ごとに、書き換えた行の数を返す */
async function scrub() {
  const results = await env.DB.batch(SCRUB_STATEMENTS.map((statement) => env.DB.prepare(statement)));
  return results.map((result) => result.meta.changes);
}

const snapshot = async () => ({
  users: await db.select().from(user).orderBy(user.id),
  accounts: await db.select().from(account).orderBy(account.id),
  sessions: await db.select().from(session).orderBy(session.id),
});

describe('前からあるホストの行の書き換え（ADR 0016 の W1）', () => {
  it('確かめの SELECT は、規則と違う行の数を表ごとに数え、新しい形の行は数えない', async () => {
    await insertOldHost({ userId: 'old', githubUserId: '1001' });
    await insertGithubUser(db, { userId: 'new', githubUserId: '1002' });

    expect(await check()).toEqual({ user_rows: 1, account_rows: 1, session_rows: 2 });
  });

  it('書き換えると、email・image・トークン・scope・IP・User-Agent が、新しいログインの行と同じ値になる', async () => {
    await insertOldHost({ userId: 'old', githubUserId: '1001' });

    expect(await scrub()).toEqual([1, 1, 2]);

    await expectStoredByPolicy(db, 1001);
    expect(await check()).toEqual({ user_rows: 0, account_rows: 0, session_rows: 0 });
  });

  it('name は SQL では変えない（D1 に login が無いので、手順書で1人ずつ直す）', async () => {
    await insertOldHost({ userId: 'old', githubUserId: '1001' });

    await scrub();

    expect(await db.select({ name: user.name }).from(user)).toEqual([{ name: '山田 太郎' }]);
  });

  it('2回流しても、2回目は1行も書き換えず、結果が変わらない', async () => {
    await insertOldHost({ userId: 'old', githubUserId: '1001' });
    await scrub();
    const first = await snapshot();

    expect(await scrub()).toEqual([0, 0, 0]);

    expect(await snapshot()).toEqual(first);
  });

  it('新しい形の行と、ほかのホストの行は、そのまま残る', async () => {
    await insertGithubUser(db, { userId: 'new', githubUserId: '1002' });
    const before = await snapshot();

    expect(await scrub()).toEqual([0, 0, 0]);

    expect(await snapshot()).toEqual(before);
  });

  it('GitHub の account が無い user は書き換えず、書き換え全体も止まらない', async () => {
    // 合成の email は account_id から作るので、account が無いと NULL になり、NOT NULL に当たって文ごと失敗する
    await db.insert(user).values({ id: 'orphan', name: 'orphan', email: 'orphan@example.com' });
    await insertOldHost({ userId: 'old', githubUserId: '1001' });

    expect(await scrub()).toEqual([1, 1, 2]);

    expect(await db.select({ email: user.email }).from(user).where(eq(user.id, 'orphan'))).toEqual([
      { email: 'orphan@example.com' },
    ]);
  });

  it('書き換えたあとも、同じ人が同じ user でログインでき、新しいセッションも規則どおりになる', async () => {
    await insertOldHost({ userId: 'old', githubUserId: '1001' });
    await allowGithubUser(db, '1001');
    await scrub();
    mockGithub(1001);

    const { callback } = await signInWithGithub();

    expect(sessionCookieOf(callback)).toBeDefined();
    expect(await db.select({ id: user.id }).from(user)).toEqual([{ id: 'old' }]);
    expect(await db.select().from(session).where(eq(session.userId, 'old'))).toHaveLength(3);
    await expectStoredByPolicy(db, 1001);
  });
});
