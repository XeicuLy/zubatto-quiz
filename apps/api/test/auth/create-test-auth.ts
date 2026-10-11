import { betterAuth } from 'better-auth';
import { testUtils } from 'better-auth/plugins';

import { createAuthOptions } from '../../src/auth/create-auth';
import type { Db } from '../../src/db';
import { account, hostAllowlist, user } from '../../src/db/schema';

/**
 * テスト専用の auth インスタンス（ADR 0003）。本番と同じ設定に testUtils だけを足す。
 * 本番のコード（src/）からは import しない。oxlint の no-restricted-imports で止めている。
 */
export async function createTestAuth(env: Env) {
  const auth = betterAuth({ ...createAuthOptions(env), plugins: [testUtils()] });
  const { test } = await auth.$context;
  return { auth, test };
}

/**
 * GitHub でログインしたことのあるホストを、Better Auth が作るのと同じ形で D1 に入れる。
 * testUtils の saveUser は validateUserInfo を通り、テストからは拒否されるので、drizzle で直接入れる。
 */
export async function insertGithubUser(db: Db, { userId, githubUserId }: { userId: string; githubUserId: string }) {
  await db.insert(user).values({ id: userId, name: userId, email: `${userId}@example.com` });
  await db.insert(account).values({ id: `${userId}-github`, userId, providerId: 'github', accountId: githubUserId });
}

export const allowGithubUser = (db: Db, githubUserId: string) => db.insert(hostAllowlist).values({ githubUserId });
