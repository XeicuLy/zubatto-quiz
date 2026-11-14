import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '@/db';
import { account, hostAllowlist, user } from '@/db/schema';

import { isAdminUser, isAllowedGithubUser, isAllowedUser } from './allowlist';

// vitest-plugin はテストごとには D1 を戻さないので、テストの前に空にする（user を消すと account も消える）
const db = createDb(env.DB);

beforeEach(async () => {
  await db.delete(user);
  await db.delete(hostAllowlist);
});

const allow = (githubUserId: string, isAdmin = false) => db.insert(hostAllowlist).values({ githubUserId, isAdmin });

/** Better Auth が GitHub のログインで作るのと同じ形で、user と account を入れる */
const insertUserWithAccount = async (userId: string, providerId: string, accountId: string) => {
  await db.insert(user).values({ id: userId, name: userId, email: `${userId}@example.com` });
  await db.insert(account).values({ id: `${userId}-${providerId}`, userId, providerId, accountId });
};

describe('isAllowedGithubUser（新しく登録するとき）', () => {
  it('許可リストにある GitHub のユーザー ID なら true', async () => {
    await allow('1001');

    expect(await isAllowedGithubUser(db, '1001')).toBe(true);
  });

  it('許可リストにない GitHub のユーザー ID なら false', async () => {
    await allow('1001');

    expect(await isAllowedGithubUser(db, '1002')).toBe(false);
  });
});

describe('isAllowedUser（セッションを作るとき）', () => {
  it('GitHub の account が許可リストにある user なら true', async () => {
    await insertUserWithAccount('alice', 'github', '1001');
    await allow('1001');

    expect(await isAllowedUser(db, 'alice')).toBe(true);
  });

  it('GitHub の account が許可リストにない user なら false', async () => {
    await insertUserWithAccount('alice', 'github', '1001');

    expect(await isAllowedUser(db, 'alice')).toBe(false);
  });

  it('許可リストから外したら false になる', async () => {
    await insertUserWithAccount('alice', 'github', '1001');
    await allow('1001');
    await db.delete(hostAllowlist);

    expect(await isAllowedUser(db, 'alice')).toBe(false);
  });

  it('GitHub 以外の account の ID が許可リストの値と同じでも false', async () => {
    // ほかのログイン方法を足したとき、その方法の ID が偶然 GitHub の ID と同じでも通さない
    await insertUserWithAccount('alice', 'google', '1001');
    await allow('1001');

    expect(await isAllowedUser(db, 'alice')).toBe(false);
  });

  it('ほかの user の GitHub の ID が許可リストにあっても false', async () => {
    await insertUserWithAccount('alice', 'github', '1001');
    await insertUserWithAccount('bob', 'github', '1002');
    await allow('1002');

    expect(await isAllowedUser(db, 'alice')).toBe(false);
  });

  it('account のない user なら false', async () => {
    await db.insert(user).values({ id: 'alice', name: 'alice', email: 'alice@example.com' });
    await allow('1001');

    expect(await isAllowedUser(db, 'alice')).toBe(false);
  });
});

describe('isAdminUser（管理者だけの経路・ADR 0013）', () => {
  it('GitHub の account が、管理者の印のある許可リストの行にある user なら true', async () => {
    await insertUserWithAccount('alice', 'github', '1001');
    await allow('1001', true);

    expect(await isAdminUser(db, 'alice')).toBe(true);
  });

  it('許可リストにあっても、管理者の印がなければ false', async () => {
    await insertUserWithAccount('alice', 'github', '1001');
    await allow('1001');

    expect(await isAdminUser(db, 'alice')).toBe(false);
  });

  it('管理者の印を外したら false になる', async () => {
    await insertUserWithAccount('alice', 'github', '1001');
    await allow('1001', true);
    await db.update(hostAllowlist).set({ isAdmin: false });

    expect(await isAdminUser(db, 'alice')).toBe(false);
  });

  it('許可リストにない user なら false', async () => {
    await insertUserWithAccount('alice', 'github', '1001');

    expect(await isAdminUser(db, 'alice')).toBe(false);
  });

  it('GitHub 以外の account の ID が管理者の行の値と同じでも false', async () => {
    await insertUserWithAccount('alice', 'google', '1001');
    await allow('1001', true);

    expect(await isAdminUser(db, 'alice')).toBe(false);
  });

  it('ほかの user が管理者でも false', async () => {
    await insertUserWithAccount('alice', 'github', '1001');
    await insertUserWithAccount('bob', 'github', '1002');
    await allow('1001');
    await allow('1002', true);

    expect(await isAdminUser(db, 'alice')).toBe(false);
  });
});
