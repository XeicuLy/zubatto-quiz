import { betterAuth } from 'better-auth';
import { testUtils } from 'better-auth/plugins';

import { createAuthOptions } from '@/auth/create-auth';
import type { Db } from '@/db';
import { account, hostAllowlist, user } from '@/db/schema';

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
export async function insertGithubUser(
  db: Db,
  { userId, githubUserId, name = userId }: { userId: string; githubUserId: string; name?: string },
) {
  await db.insert(user).values({ id: userId, name, email: `${userId}@example.com` });
  await db.insert(account).values({ id: `${userId}-github`, userId, providerId: 'github', accountId: githubUserId });
}

/** GitHub のユーザー ID を許可リストに入れる。admin を true にすると管理者の行にする（ADR 0013） */
export const allowGithubUser = (db: Db, githubUserId: string, { admin = false }: { admin?: boolean } = {}) =>
  db.insert(hostAllowlist).values({ githubUserId, isAdmin: admin });
