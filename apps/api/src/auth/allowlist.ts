import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import { account, hostAllowlist } from '../db/schema';

/**
 * 新しく登録するときに使う。GitHub のユーザー ID が許可リストにあるかを返す（S1・ADR 0003）。
 * 登録のときは、まだ account の行がないので、GitHub から受け取ったプロフィールの ID で確かめる。
 */
export async function isAllowedGithubUser(db: Db, githubUserId: string): Promise<boolean> {
  const row = await db
    .select({ githubUserId: hostAllowlist.githubUserId })
    .from(hostAllowlist)
    .where(eq(hostAllowlist.githubUserId, githubUserId))
    .get();
  return row !== undefined;
}

/**
 * セッションを作るとき（ログインのたび）に使う。user の GitHub の account が許可リストにあるかを返す（S1・ADR 0003）。
 * 許可リストから外したホストは、次のログインで拒否される。
 */
export async function isAllowedUser(db: Db, userId: string): Promise<boolean> {
  // providerId でも絞る。ほかのログイン方法を足したとき、その ID が偶然 GitHub の ID と同じでも通さない
  const row = await db
    .select({ userId: account.userId })
    .from(account)
    .innerJoin(hostAllowlist, eq(account.accountId, hostAllowlist.githubUserId))
    .where(and(eq(account.userId, userId), eq(account.providerId, 'github')))
    .get();
  return row !== undefined;
}
