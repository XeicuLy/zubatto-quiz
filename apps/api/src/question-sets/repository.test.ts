import { MAX_QUESTIONS, type QuestionSet } from '@zubatto-quiz/protocol';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '../db';
import { questions, questionSets, user } from '../db/schema';
import {
  createQuestionSet,
  deleteQuestionSet,
  getQuestionSet,
  listQuestionSets,
  updateQuestionSet,
} from './repository';

// vitest-plugin はテストごとには D1 を戻さないので、テストの前に空にする（user を消すと問題セットと問題も消える）
const db = createDb(env.DB);

// 2人のホスト。alice が自分のセットを扱い、mallory が alice のセットに手を出そうとする（S1・ADR 0002）
beforeEach(async () => {
  await db.delete(user);
  await db.insert(user).values([
    { id: 'alice', name: 'alice', email: 'alice@example.com' },
    { id: 'mallory', name: 'mallory', email: 'mallory@example.com' },
  ]);
});

const input: QuestionSet = {
  title: '忘年会クイズ',
  questions: [
    { text: '社長の好物は？', choices: ['寿司', '焼肉', 'カレー'], correctIndex: 2, limitMs: 10_000 },
    { text: '会社の創立は何年？', choices: ['1999', '2005'], correctIndex: 0, limitMs: 20_000 },
    { text: '本社のある県は？', choices: ['東京', '大阪', '福岡', '北海道'], correctIndex: 3, limitMs: 5_000 },
  ],
};

describe('createQuestionSet と getQuestionSet', () => {
  it('作ったセットを、題名と問題（正解を含む）ごと、入れた順番で取り出せる', async () => {
    const { id } = await createQuestionSet(db, { ownerId: 'alice', input });

    expect(await getQuestionSet(db, { ownerId: 'alice', setId: id })).toEqual({ id, ...input });
  });

  it('問題の数が上限（MAX_QUESTIONS）のセットも、作って更新して取り出せる', async () => {
    // D1 は1つの文に渡せる値を100個までにしている。7列の問題を100問入れると700個になるので、文を分けないと失敗する
    const full: QuestionSet = {
      title: '100問クイズ',
      questions: Array.from({ length: MAX_QUESTIONS }, (_, i) => ({
        text: `第${i + 1}問`,
        choices: ['A', 'B'],
        correctIndex: i % 2,
        limitMs: 10_000,
      })),
    };
    const { id } = await createQuestionSet(db, { ownerId: 'alice', input: full });
    expect(await getQuestionSet(db, { ownerId: 'alice', setId: id })).toEqual({ id, ...full });

    const reversed = { ...full, questions: [...full.questions].reverse() };
    await updateQuestionSet(db, { ownerId: 'alice', setId: id, input: reversed });
    expect(await getQuestionSet(db, { ownerId: 'alice', setId: id })).toEqual({ id, ...reversed });
  });

  it('ないセットの id では undefined', async () => {
    expect(await getQuestionSet(db, { ownerId: 'alice', setId: 'missing' })).toBeUndefined();
  });
});

const edited: QuestionSet = {
  title: '新年会クイズ',
  questions: [{ text: '今年の目標は？', choices: ['健康', '貯金'], correctIndex: 1, limitMs: 30_000 }],
};

describe('listQuestionSets', () => {
  it('自分のセットを、問題の数と一緒に、更新の新しい順に返す', async () => {
    const older = await createQuestionSet(db, { ownerId: 'alice', input });
    const newer = await createQuestionSet(db, { ownerId: 'alice', input: edited });
    // 同じミリ秒に作られても順番が決まるよう、older の更新日時を過去にずらす
    await db
      .update(questionSets)
      .set({ updatedAt: new Date(0) })
      .where(eq(questionSets.id, older.id));

    expect(await listQuestionSets(db, { ownerId: 'alice' })).toEqual([
      { id: newer.id, title: '新年会クイズ', questionCount: 1, updatedAt: expect.any(Date) },
      { id: older.id, title: '忘年会クイズ', questionCount: 3, updatedAt: new Date(0) },
    ]);
  });

  it('セットがなければ空の配列', async () => {
    expect(await listQuestionSets(db, { ownerId: 'alice' })).toEqual([]);
  });
});

describe('updateQuestionSet', () => {
  it('題名と問題を入れ替え、true を返す', async () => {
    const { id } = await createQuestionSet(db, { ownerId: 'alice', input });

    expect(await updateQuestionSet(db, { ownerId: 'alice', setId: id, input: edited })).toBe(true);
    expect(await getQuestionSet(db, { ownerId: 'alice', setId: id })).toEqual({ id, ...edited });
  });

  it('ないセットの id では false', async () => {
    expect(await updateQuestionSet(db, { ownerId: 'alice', setId: 'missing', input: edited })).toBe(false);
  });

  it('問題の書き込みが DB の制約で失敗したら、題名も元のまま残る', async () => {
    const { id } = await createQuestionSet(db, { ownerId: 'alice', input });
    // protocol の検査をすり抜けた入力。DB の CHECK（正解の番号は選択肢の中）で止まる
    const broken: QuestionSet = {
      title: '壊れたクイズ',
      questions: [{ text: '？', choices: ['A', 'B'], correctIndex: 3, limitMs: 10_000 }],
    };

    await expect(updateQuestionSet(db, { ownerId: 'alice', setId: id, input: broken })).rejects.toHaveProperty(
      'cause.message',
      expect.stringMatching(/CHECK constraint failed/),
    );
    expect(await getQuestionSet(db, { ownerId: 'alice', setId: id })).toEqual({ id, ...input });
  });
});

describe('deleteQuestionSet', () => {
  it('セットと問題を消し、true を返す', async () => {
    const { id } = await createQuestionSet(db, { ownerId: 'alice', input });

    expect(await deleteQuestionSet(db, { ownerId: 'alice', setId: id })).toBe(true);
    expect(await getQuestionSet(db, { ownerId: 'alice', setId: id })).toBeUndefined();
    expect(await db.select().from(questions)).toEqual([]);
  });

  it('ないセットの id では false', async () => {
    expect(await deleteQuestionSet(db, { ownerId: 'alice', setId: 'missing' })).toBe(false);
  });
});

describe('他人の問題セット（S1・ADR 0002）', () => {
  let aliceSetId: string;

  beforeEach(async () => {
    ({ id: aliceSetId } = await createQuestionSet(db, { ownerId: 'alice', input }));
  });

  it('読めない: 取得は undefined で、一覧にも出ない', async () => {
    expect(await getQuestionSet(db, { ownerId: 'mallory', setId: aliceSetId })).toBeUndefined();
    expect(await listQuestionSets(db, { ownerId: 'mallory' })).toEqual([]);
  });

  it('書けない: 更新は false で、題名も問題も変わらない', async () => {
    expect(await updateQuestionSet(db, { ownerId: 'mallory', setId: aliceSetId, input: edited })).toBe(false);
    expect(await getQuestionSet(db, { ownerId: 'alice', setId: aliceSetId })).toEqual({ id: aliceSetId, ...input });
  });

  it('消せない: 削除は false で、セットも問題も残る', async () => {
    expect(await deleteQuestionSet(db, { ownerId: 'mallory', setId: aliceSetId })).toBe(false);
    expect(await getQuestionSet(db, { ownerId: 'alice', setId: aliceSetId })).toEqual({ id: aliceSetId, ...input });
  });
});

describe('ownerId の型（ADR 0002）', () => {
  it('どの関数も、ownerId を渡さないと型エラーになる', () => {
    // 呼び出さず、型だけを確かめる。pnpm run tsc はテストのファイルも検査するので、型エラーが出なくなると
    // 「使われていない @ts-expect-error」で CI が落ちる
    const withoutOwner = () => [
      // @ts-expect-error ownerId がない
      listQuestionSets(db, {}),
      // @ts-expect-error ownerId がない
      getQuestionSet(db, { setId: 'x' }),
      // @ts-expect-error ownerId がない
      createQuestionSet(db, { input }),
      // @ts-expect-error ownerId がない
      updateQuestionSet(db, { setId: 'x', input }),
      // @ts-expect-error ownerId がない
      deleteQuestionSet(db, { setId: 'x' }),
    ];

    expect(withoutOwner).toBeTypeOf('function');
  });
});
