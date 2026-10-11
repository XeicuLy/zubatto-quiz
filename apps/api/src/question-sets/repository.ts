import type { Question, QuestionSet } from '@zubatto-quiz/protocol';
import { and, asc, desc, eq, getTableColumns } from 'drizzle-orm';

import type { Db } from '../db';
import { questions, questionSets } from '../db/schema';

/**
 * 問題セットを D1 で読み書きする層（F7・ADR 0002）。D1 の問題セットには、ここ以外から触らない。
 *
 * S1 は仕組みではなく、クエリごとに owner_id で絞ることで守る。絞り忘れはそのまま他人のセットの漏えいになるので、
 * どの関数も ownerId を必須の引数にする。ownerId は requireHost が決めた Better Auth の user.id（ADR 0003）。
 * 引数をオブジェクトにして、ownerId と setId の文字列を取り違えにくくする。
 */
type Owner = { ownerId: string };
type OwnedSet = Owner & { setId: string };

/** setId のセットのうち、ownerId の持ち物だけに当たる条件。他人のセットとないセットは、どちらも0行になる */
const ownedSet = ({ ownerId, setId }: OwnedSet) => and(eq(questionSets.id, setId), eq(questionSets.ownerId, ownerId));

/** 一覧の1行。問題の中身（正解を含む）は持たない */
export type QuestionSetSummary = { id: string; title: string; questionCount: number; updatedAt: Date };

/** 自分のセットを、更新の新しい順に返す */
export async function listQuestionSets(db: Db, { ownerId }: Owner): Promise<QuestionSetSummary[]> {
  return db
    .select({
      id: questionSets.id,
      title: questionSets.title,
      questionCount: db.$count(questions, eq(questions.setId, questionSets.id)),
      updatedAt: questionSets.updatedAt,
    })
    .from(questionSets)
    .where(eq(questionSets.ownerId, ownerId))
    .orderBy(desc(questionSets.updatedAt));
}

/** 正解を含むセットの全体。ホストの編集画面と、部屋の作成（部屋の DO へのコピー）だけで使う（S2） */
export type StoredQuestionSet = QuestionSet & { id: string };

/**
 * セットの全体（正解を含む）を、問題の順番どおりに1回のクエリで読む（ADR 0002）。
 * 他人のセットとないセットは、どちらも undefined にする。HTTP API で区別せずに 404 にできる
 */
export async function getQuestionSet(db: Db, owned: OwnedSet): Promise<StoredQuestionSet | undefined> {
  return db.query.questionSets.findFirst({
    columns: { id: true, title: true },
    where: ownedSet(owned),
    with: {
      questions: {
        columns: { text: true, choices: true, correctIndex: true, limitMs: true },
        orderBy: [asc(questions.position)],
      },
    },
  });
}

/** セットを作り、id を返す。セットと問題は1つの batch（D1 の1トランザクション）で書くので、途中で失敗しても半端に残らない */
export async function createQuestionSet(
  db: Db,
  { ownerId, input }: Owner & { input: QuestionSet },
): Promise<{ id: string }> {
  // 問題の set_id に使うので、id は D1 ではなくここで作る
  const id = crypto.randomUUID();
  await db.batch([
    db.insert(questionSets).values({ id, ownerId, title: input.title }),
    ...insertQuestions(db, id, input.questions),
  ]);
  return { id };
}

/**
 * 題名と問題をまるごと入れ替える。他人のセットとないセットでは何もせず false を返す。
 *
 * batch の中では「UPDATE が0行なら後ろを止める」ことができない。持ち主を確かめずに流すと、
 * 他人のセットの set_id で問題を挿入できてしまうので、先に owner_id で絞って確かめる。
 * owner_id は変わらない列なので、確かめたあとに持ち主が入れ替わることはない。
 * その間にセットが消された場合は、問題の挿入が外部キーで失敗し、batch 全体が取り消される。
 */
export async function updateQuestionSet(
  db: Db,
  { input, ...owned }: OwnedSet & { input: QuestionSet },
): Promise<boolean> {
  const found = await db.select({ id: questionSets.id }).from(questionSets).where(ownedSet(owned)).get();
  if (!found) {
    return false;
  }
  await db.batch([
    // updated_at は schema の $onUpdate で今の時刻になる
    db.update(questionSets).set({ title: input.title }).where(ownedSet(owned)),
    db.delete(questions).where(eq(questions.setId, owned.setId)),
    ...insertQuestions(db, owned.setId, input.questions),
  ]);
  return true;
}

/** セットを消す。問題は外部キーの cascade で一緒に消える。他人のセットとないセットでは false を返す */
export async function deleteQuestionSet(db: Db, owned: OwnedSet): Promise<boolean> {
  const deleted = await db.delete(questionSets).where(ownedSet(owned)).returning({ id: questionSets.id });
  return deleted.length > 0;
}

// D1 は1つの文に渡せる値を100個までにしている（batch の中の文1つずつにもかかる。2026-10-11 に確認）。
// 問題の1行は列の数だけ値を使うので、MAX_QUESTIONS の100問を1つの INSERT には入れられない
const D1_MAX_BOUND_PARAMETERS = 100;
const QUESTIONS_PER_INSERT = Math.floor(D1_MAX_BOUND_PARAMETERS / Object.keys(getTableColumns(questions)).length);

/** 問題を、値の上限に収まる INSERT に分ける。配列の添字を position にして、問題の順番を保つ */
const insertQuestions = (db: Db, setId: string, items: readonly Question[]) => {
  const rows = items.map((question, position) => ({ setId, position, ...question }));
  return Array.from({ length: Math.ceil(rows.length / QUESTIONS_PER_INSERT) }, (_, i) =>
    db.insert(questions).values(rows.slice(i * QUESTIONS_PER_INSERT, (i + 1) * QUESTIONS_PER_INSERT)),
  );
};
