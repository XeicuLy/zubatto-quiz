import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '@/db';
import { hostAllowlist, session } from '@/db/schema';

import { loginAs, resetHosts } from '../../test/host-request';
import { addHost, listHosts, removeHost } from './repository';

const db = createDb(env.DB);

// admin（1000・管理者）・alice（1001）・mallory（1002）の3人
beforeEach(resetHosts);

/** userId のセッションの数 */
const sessionCount = async (userId: string) =>
  (await db.select().from(session).where(eq(session.userId, userId))).length;

describe('listHosts', () => {
  it('許可リストの行を、足した順（古い順）に返す', async () => {
    // 足した時刻の順と ID の順を逆にして、ID ではなく時刻で並べていることを見る
    await db
      .update(hostAllowlist)
      .set({ createdAt: new Date(3000) })
      .where(eq(hostAllowlist.githubUserId, '1000'));
    await db
      .update(hostAllowlist)
      .set({ createdAt: new Date(2000) })
      .where(eq(hostAllowlist.githubUserId, '1001'));
    await db
      .update(hostAllowlist)
      .set({ createdAt: new Date(1000) })
      .where(eq(hostAllowlist.githubUserId, '1002'));

    expect(await listHosts(db)).toEqual([
      { githubUserId: '1002', note: null, isAdmin: false, createdAt: new Date(1000) },
      { githubUserId: '1001', note: null, isAdmin: false, createdAt: new Date(2000) },
      { githubUserId: '1000', note: null, isAdmin: true, createdAt: new Date(3000) },
    ]);
  });
});

describe('addHost', () => {
  it('管理者でない行として足し、その行を返す', async () => {
    const added = await addHost(db, { githubUserId: '2000', note: 'octocat' });

    expect(added).toEqual({ githubUserId: '2000', note: 'octocat', isAdmin: false, createdAt: expect.any(Date) });
    expect(await listHosts(db)).toContainEqual(added);
  });

  it('すでにある ID なら undefined を返し、行（管理者の印とメモ）を変えない', async () => {
    await db.update(hostAllowlist).set({ note: 'admin' }).where(eq(hostAllowlist.githubUserId, '1000'));

    expect(await addHost(db, { githubUserId: '1000', note: 'renamed' })).toBeUndefined();
    expect(await listHosts(db)).toContainEqual(
      expect.objectContaining({ githubUserId: '1000', note: 'admin', isAdmin: true }),
    );
  });

  it('同じ ID を同時に2回足しても、行は1つで、片方だけが足したことになる', async () => {
    const results = await Promise.all([
      addHost(db, { githubUserId: '2000', note: 'octocat' }),
      addHost(db, { githubUserId: '2000', note: 'octocat' }),
    ]);

    expect(results.filter((result) => result !== undefined)).toHaveLength(1);
    expect(await db.select().from(hostAllowlist).where(eq(hostAllowlist.githubUserId, '2000'))).toHaveLength(1);
  });
});

describe('removeHost', () => {
  it('許可リストの行と、その人のセッションを消す。ほかの人のセッションは残す', async () => {
    await loginAs('alice');
    await loginAs('alice');
    await loginAs('mallory');

    expect(await removeHost(db, '1001')).toBe('removed');
    expect(await db.select().from(hostAllowlist).where(eq(hostAllowlist.githubUserId, '1001'))).toEqual([]);
    expect(await sessionCount('alice')).toBe(0);
    expect(await sessionCount('mallory')).toBe(1);
  });

  it('一度もログインしていない人（account がない）も外せる', async () => {
    await addHost(db, { githubUserId: '2000', note: 'octocat' });

    expect(await removeHost(db, '2000')).toBe('removed');
    expect(await db.select().from(hostAllowlist).where(eq(hostAllowlist.githubUserId, '2000'))).toEqual([]);
  });

  it('管理者の行は外さず、admin を返す。その人のセッションも残す', async () => {
    await loginAs('admin');

    expect(await removeHost(db, '1000')).toBe('admin');
    expect(await db.select().from(hostAllowlist).where(eq(hostAllowlist.githubUserId, '1000'))).toHaveLength(1);
    expect(await sessionCount('admin')).toBe(1);
  });

  it('許可リストにない ID なら notFound を返し、何も消さない', async () => {
    await loginAs('alice');

    expect(await removeHost(db, '9999')).toBe('notFound');
    expect(await listHosts(db)).toHaveLength(3);
    expect(await sessionCount('alice')).toBe(1);
  });

  it('コマンドで行だけを外した人は notFound（残ったセッションは requireHost が通さない）', async () => {
    await loginAs('alice');
    await db.delete(hostAllowlist).where(eq(hostAllowlist.githubUserId, '1001'));

    expect(await removeHost(db, '1001')).toBe('notFound');
  });
});
