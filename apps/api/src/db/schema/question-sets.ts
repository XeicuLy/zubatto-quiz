import { DEFAULT_LIMIT_MS, MAX_CHOICES, MAX_LIMIT_MS, MIN_CHOICES, MIN_LIMIT_MS } from '@zubatto-quiz/protocol';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

import { user } from './auth';

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

// CHECK は CREATE TABLE の中に書くので、? の引数は使えない。protocol の定数を数の文字としてそのまま埋める
const literal = (n: number) => sql.raw(String(n));

/**
 * 問題セット（F7）。ホストごとに持つ（ADR 0002）。D1 を読み書きするときは、いつも owner_id で絞る。
 */
export const questionSets = sqliteTable(
  'question_sets',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Better Auth の user.id（ADR 0003）。ユーザーを消したら、その人の問題セットも消す
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).default(nowMs).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index('question_sets_owner_id_idx').on(t.ownerId)],
);

/**
 * 問題（F4・F9）。正解を含むので、部屋の DO へ写すまでは D1 の外へ出さない（S2・ADR 0002）。
 * 入力は packages/protocol の questionSchema で確かめる。下の CHECK は、それをすり抜けた書き込み（wrangler d1 execute など）を止める最後の守り
 */
export const questions = sqliteTable(
  'questions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    setId: text('set_id')
      .notNull()
      .references(() => questionSets.id, { onDelete: 'cascade' }),
    // 何問目か（0始まり）。protocol の questionIndexSchema と同じ数え方
    position: integer('position').notNull(),
    // Markdown（F5）
    text: text('text').notNull(),
    // 選択肢の文字列の JSON の配列。いつも問題と一緒に読み書きし、1つずつ探したり指したりしないので、表を分けない
    choices: text('choices', { mode: 'json' }).$type<string[]>().notNull(),
    // 正解の選択肢の番号（0始まり）
    correctIndex: integer('correct_index').notNull(),
    limitMs: integer('limit_ms').default(DEFAULT_LIMIT_MS).notNull(),
  },
  (t) => [
    unique('questions_set_id_position_unique').on(t.setId, t.position),
    // F9: 制限時間は5〜60秒の1秒単位
    check(
      'questions_limit_ms_range',
      sql`${t.limitMs} between ${literal(MIN_LIMIT_MS)} and ${literal(MAX_LIMIT_MS)} and ${t.limitMs} % 1000 = 0`,
    ),
    // F4: 選択肢は2〜4
    check(
      'questions_choices_count',
      sql`json_array_length(${t.choices}) between ${literal(MIN_CHOICES)} and ${literal(MAX_CHOICES)}`,
    ),
    // 正解の番号は選択肢の中。protocol の questionSchema の refine と同じ条件
    check(
      'questions_correct_index_range',
      sql`${t.correctIndex} >= 0 and ${t.correctIndex} < json_array_length(${t.choices})`,
    ),
  ],
);
