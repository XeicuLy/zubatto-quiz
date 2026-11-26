import type { QuestionSet } from '@zubatto-quiz/protocol';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '@/db';
import { account, hostAllowlist, questions, questionSets, session, user } from '@/db/schema';
import { createQuestionSet } from '@/question-sets/repository';

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
  const twoQuestions: QuestionSet = {
    title: 'テストのセット',
    questions: [
      { text: '社長の好物は？', choices: ['寿司', '焼肉'], correctIndex: 0, limitMs: 10_000 },
      { text: '本社のある県は？', choices: ['東京', '大阪'], correctIndex: 1, limitMs: 10_000 },
    ],
  };

  /** userId のホストがログインし、2問の問題セットを1つ作る。作ったセットの ID を返す */
  async function seedHost(userId: string) {
    await loginAs(userId);
    const { id } = await createQuestionSet(db, { ownerId: userId, input: twoQuestions });
    return id;
  }

  /**
   * userId の人が D1 に持つ行の数を、表ごとに数える。問題は持ち主の列を持たないので、seedHost が返したセットの ID で数える
   * （セットが消えたあとも数えられるように）
   */
  const rowCounts = async (userId: string, setId: string) => ({
    user: (await db.select().from(user).where(eq(user.id, userId))).length,
    account: (await db.select().from(account).where(eq(account.userId, userId))).length,
    session: await sessionCount(userId),
    questionSets: (await db.select().from(questionSets).where(eq(questionSets.ownerId, userId))).length,
    questions: (await db.select().from(questions).where(eq(questions.setId, setId))).length,
  });
  const KEPT = { user: 1, account: 1, session: 1, questionSets: 1, questions: 2 };
  const GONE = { user: 0, account: 0, session: 0, questionSets: 0, questions: 0 };

  it('許可リストの行と、その人の user・account・session・問題セット・問題を消す。ほかの人の行は残す', async () => {
    const sets = { admin: await seedHost('admin'), alice: await seedHost('alice'), mallory: await seedHost('mallory') };

    expect(await removeHost(db, '1001')).toBe('removed');
    expect(await db.select().from(hostAllowlist).where(eq(hostAllowlist.githubUserId, '1001'))).toEqual([]);
    expect(await rowCounts('alice', sets.alice)).toEqual(GONE);
    expect(await rowCounts('mallory', sets.mallory)).toEqual(KEPT);
    expect(await rowCounts('admin', sets.admin)).toEqual(KEPT);
    expect(await listHosts(db)).toHaveLength(2);
  });

  it('一度もログインしていない人（user も account もない）も外せる。ほかの人の行は残す', async () => {
    const aliceSet = await seedHost('alice');
    await addHost(db, { githubUserId: '2000', note: 'octocat' });

    expect(await removeHost(db, '2000')).toBe('removed');
    expect(await db.select().from(hostAllowlist).where(eq(hostAllowlist.githubUserId, '2000'))).toEqual([]);
    expect(await listHosts(db)).toHaveLength(3);
    expect(await rowCounts('alice', aliceSet)).toEqual(KEPT);
  });

  it('管理者の行は外さず、admin を返す。その人の行はどの表からも消さない', async () => {
    const adminSet = await seedHost('admin');

    expect(await removeHost(db, '1000')).toBe('admin');
    expect(await db.select().from(hostAllowlist).where(eq(hostAllowlist.githubUserId, '1000'))).toHaveLength(1);
    expect(await rowCounts('admin', adminSet)).toEqual(KEPT);
  });

  it('許可リストにない ID なら notFound を返し、何も消さない', async () => {
    const aliceSet = await seedHost('alice');

    expect(await removeHost(db, '9999')).toBe('notFound');
    expect(await listHosts(db)).toHaveLength(3);
    expect(await rowCounts('alice', aliceSet)).toEqual(KEPT);
  });

  it('コマンドで行だけを外した人は notFound（残ったセッションは requireHost が通さない）', async () => {
    await loginAs('alice');
    await db.delete(hostAllowlist).where(eq(hostAllowlist.githubUserId, '1001'));

    expect(await removeHost(db, '1001')).toBe('notFound');
  });
});
