import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Db } from '@/db';
import { account, hostAllowlist, session } from '@/db/schema';

/** 許可リストの1行。応答では createdAt を ISO の文字列にする */
export interface HostRow {
  githubUserId: string;
  note: string | null;
  isAdmin: boolean;
  createdAt: Date;
}

const hostColumns = {
  githubUserId: hostAllowlist.githubUserId,
  note: hostAllowlist.note,
  isAdmin: hostAllowlist.isAdmin,
  createdAt: hostAllowlist.createdAt,
};

/**
 * 許可リストを、足した順（古い順）に返す（ADR 0013）。管理者だけの経路から使う。
 * 同じミリ秒に足した行の順が揺れないよう、ID でも並べる
 */
export const listHosts = (db: Db): Promise<HostRow[]> =>
  db.select(hostColumns).from(hostAllowlist).orderBy(asc(hostAllowlist.createdAt), asc(hostAllowlist.githubUserId));

/**
 * 管理者でない行として許可リストに足し、足した行を返す。すでにある ID なら何も変えずに undefined を返す。
 * 判定と追加を1つの文で行うので、同じ人を同時に2回足しても1行だけになる（主キーの重なりを DO NOTHING で流す）
 */
export async function addHost(db: Db, { githubUserId, note }: { githubUserId: string; note: string }) {
  const [row] = await db
    .insert(hostAllowlist)
    .values({ githubUserId, note })
    .onConflictDoNothing()
    .returning(hostColumns);
  return row;
}

/**
 * ホストを許可リストから外し、その人のセッションも一緒に消す（ADR 0013）。runbook の2手順を1回で行う。
 *
 * D1 の batch は1つのトランザクションなので、片方だけが消えることはない。どちらの DELETE にも「管理者でない」の条件を入れ、
 * 先に確かめずに消してから、消えなかったときだけ理由を読む。確かめてから消すまでの間に管理者の印が付いても、消さない。
 * セッションの user_id は Better Auth の user の ID なので、GitHub の ID から account を引く。セッションの文は許可リストの行を
 * 参照するので、行を消す文より先に置く
 */
export async function removeHost(db: Db, githubUserId: string): Promise<'removed' | 'admin' | 'notFound'> {
  const removable = and(eq(hostAllowlist.githubUserId, githubUserId), eq(hostAllowlist.isAdmin, false));
  const [, removed] = await db.batch([
    db.delete(session).where(
      inArray(
        session.userId,
        db
          .select({ userId: account.userId })
          .from(account)
          .innerJoin(hostAllowlist, eq(account.accountId, hostAllowlist.githubUserId))
          .where(and(eq(account.providerId, 'github'), removable)),
      ),
    ),
    db.delete(hostAllowlist).where(removable).returning({ githubUserId: hostAllowlist.githubUserId }),
  ]);
  if (removed.length > 0) {
    return 'removed';
  }
  const row = await db
    .select({ isAdmin: hostAllowlist.isAdmin })
    .from(hostAllowlist)
    .where(eq(hostAllowlist.githubUserId, githubUserId))
    .get();
  return row?.isAdmin ? 'admin' : 'notFound';
}
