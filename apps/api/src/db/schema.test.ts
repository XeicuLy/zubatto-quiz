import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDb } from './index';
import { account, hostAllowlist, questions, questionSets, user } from './schema';

// マイグレーションは test/apply-migrations.ts で当たっている。
// vitest-plugin はテストごとには D1 を戻さないので、テストの前に空にする（user を消すと問題セットと問題も消える）
// drizzle は D1 のエラーを「Failed query: ...」で包み、元のエラーを cause に入れる。どの制約で止まったかは cause.message で見る
const db = createDb(env.DB);

beforeEach(async () => {
  await db.delete(user);
  await db.delete(hostAllowlist);
});

const insertUser = (id: string) => db.insert(user).values({ id, name: id, email: `${id}@example.com` });

const insertSet = async (ownerId: string) => {
  const [set] = await db.insert(questionSets).values({ ownerId, title: '忘年会クイズ' }).returning();
  return set!;
};

const question = (setId: string, choices: string[], correctIndex = 0) => ({
  setId,
  position: 0,
  text: '社長の好物は？',
  choices,
  correctIndex,
});

describe('マイグレーション（ADR 0005）', () => {
  it('Better Auth・問題セット・許可リストの表ができている', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations' ORDER BY name",
    ).all<{ name: string }>();

    expect(results.map((row) => row.name)).toEqual([
      'account',
      'host_allowlist',
      'question_sets',
      'questions',
      'session',
      'user',
      'verification',
    ]);
  });
});

describe('question_sets.owner_id（ADR 0003）', () => {
  beforeEach(async () => {
    await insertUser('alice');
  });

  it('Better Auth の user.id を持ち主にできる', async () => {
    const set = await insertSet('alice');

    expect(set.ownerId).toBe('alice');
    expect(set.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('いない user.id は持ち主にできない', async () => {
    await expect(insertSet('mallory')).rejects.toHaveProperty(
      'cause.message',
      expect.stringMatching(/FOREIGN KEY constraint failed/),
    );
  });

  it('user を消すと、その人の問題セットと問題も消える', async () => {
    const set = await insertSet('alice');
    await db.insert(questions).values(question(set.id, ['赤', '青']));

    await db.delete(user).where(eq(user.id, 'alice'));

    expect(await db.select().from(questionSets)).toEqual([]);
    expect(await db.select().from(questions)).toEqual([]);
  });

  it('owner_id に索引がある', async () => {
    const { results } = await env.DB.prepare("PRAGMA index_list('question_sets')").all<{ name: string }>();

    expect(results.map((row) => row.name)).toContain('question_sets_owner_id_idx');
  });
});

describe('questions', () => {
  let setId: string;

  beforeEach(async () => {
    await insertUser('alice');
    setId = (await insertSet('alice')).id;
  });

  it('選択肢を配列のまま読み戻せ、制限時間は10,000ミリ秒になる（F9）', async () => {
    await db.insert(questions).values(question(setId, ['赤', '青', '黄'], 2));

    const [row] = await db.select().from(questions);

    expect(row).toMatchObject({ choices: ['赤', '青', '黄'], correctIndex: 2, limitMs: 10_000 });
  });

  it('同じ問題セットに同じ順番の問題は2つ入らない', async () => {
    await db.insert(questions).values(question(setId, ['赤', '青']));

    await expect(db.insert(questions).values(question(setId, ['白', '黒']))).rejects.toHaveProperty(
      'cause.message',
      expect.stringMatching(/UNIQUE constraint failed/),
    );
  });

  describe('選択肢が2〜4（F4）', () => {
    it.each([[['赤', '青']], [['赤', '青', '黄', '緑']]])('%j は入る', async (choices) => {
      await db.insert(questions).values(question(setId, choices));

      expect(await db.$count(questions)).toBe(1);
    });

    it.each([[['赤']], [['赤', '青', '黄', '緑', '白']]])('%j は入らない', async (choices) => {
      await expect(db.insert(questions).values(question(setId, choices))).rejects.toHaveProperty(
        'cause.message',
        expect.stringMatching(/CHECK constraint failed: questions_choices_count/),
      );
    });

    // 型を通らない書き込み（wrangler d1 execute など）の代わりに、string[] でない値を型を外して入れる
    it.each([[['赤', null]], [['赤', 1]], [[['赤'], '青']], [['赤', '青', '黄', null]]])(
      '文字列でない要素を含む %j は入らない',
      async (choices) => {
        await expect(
          db.insert(questions).values(question(setId, choices as unknown as string[])),
        ).rejects.toHaveProperty(
          'cause.message',
          expect.stringMatching(/CHECK constraint failed: questions_choices_text/),
        );
      },
    );

    it.each([2, -1])('正解の番号 %i は2択では入らない', async (correctIndex) => {
      await expect(db.insert(questions).values(question(setId, ['赤', '青'], correctIndex))).rejects.toHaveProperty(
        'cause.message',
        expect.stringMatching(/CHECK constraint failed: questions_correct_index_range/),
      );
    });
  });

  it.each([4_000, 61_000, 10_500])('制限時間 %i ミリ秒は入らない（F9）', async (limitMs) => {
    await expect(db.insert(questions).values({ ...question(setId, ['赤', '青']), limitMs })).rejects.toHaveProperty(
      'cause.message',
      expect.stringMatching(/CHECK constraint failed: questions_limit_ms_range/),
    );
  });
});

describe('account（Better Auth）', () => {
  beforeEach(async () => {
    await insertUser('alice');
    await insertUser('bob');
  });

  const githubAccount = (id: string, userId: string, providerId = 'github') => ({
    id,
    accountId: '1234567',
    providerId,
    userId,
    updatedAt: new Date(),
  });

  // Better Auth は (providerId, accountId) が2行以上あるアカウントを探すのを拒み、その人はログインできなくなる
  it('同じ GitHub のユーザー ID のアカウントは2つ入らない', async () => {
    await db.insert(account).values(githubAccount('a1', 'alice'));

    await expect(db.insert(account).values(githubAccount('a2', 'bob'))).rejects.toHaveProperty(
      'cause.message',
      expect.stringMatching(/UNIQUE constraint failed: account\.provider_id, account\.account_id/),
    );
  });

  it('別のログインの方法なら、同じ ID でも入る', async () => {
    await db.insert(account).values(githubAccount('a1', 'alice'));
    await db.insert(account).values(githubAccount('a2', 'bob', 'google'));

    expect(await db.$count(account)).toBe(2);
  });
});

describe('host_allowlist（ADR 0003）', () => {
  it('GitHub のユーザー ID を文字列で持てる', async () => {
    await db.insert(hostAllowlist).values({ githubUserId: '1234567', note: '幹事' });

    const [row] = await db.select().from(hostAllowlist);

    expect(row).toMatchObject({ githubUserId: '1234567', note: '幹事' });
    expect(row!.createdAt).toBeInstanceOf(Date);
  });

  it('同じ ID は2度入らない', async () => {
    await db.insert(hostAllowlist).values({ githubUserId: '1234567' });

    await expect(db.insert(hostAllowlist).values({ githubUserId: '1234567' })).rejects.toHaveProperty(
      'cause.message',
      expect.stringMatching(/UNIQUE constraint failed/),
    );
  });
});
