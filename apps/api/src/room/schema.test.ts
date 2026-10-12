import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Attachment } from './attachment';
import { migrate } from './migrate';
import { ROOM_SCHEMA_VERSION } from './schema';

// 部屋の DO はコンストラクタでマイグレーションを当てるので、runInDurableObject の中では表がもうある
const insertRoom = (sql: SqlStorage) =>
  sql.exec(
    `INSERT INTO room (id, owner_id, title, phase, created_at) VALUES (1, 'owner-1', 'テスト', 'lobby', ?)`,
    Date.now(),
  );

const insertQuestion = (sql: SqlStorage, id: string, position: number) =>
  sql.exec(
    `INSERT INTO questions (id, position, text, choices, correct_index, limit_ms) VALUES (?, ?, '問題', ?, 0, 10000)`,
    id,
    position,
    JSON.stringify(['A', 'B']),
  );

const insertParticipant = (sql: SqlStorage, participantId: string, name: string, normalizedName: string) =>
  sql.exec(
    `INSERT INTO participants (participant_id, name, normalized_name, token_hash, joined_at) VALUES (?, ?, ?, ?, ?)`,
    participantId,
    name,
    normalizedName,
    new Uint8Array(32),
    Date.now(),
  );

const insertAnswer = (sql: SqlStorage, questionId: string, participantId: string, choiceIndex: number) =>
  sql.exec(
    `INSERT INTO answers (question_id, participant_id, choice_index, elapsed_ms, received_at) VALUES (?, ?, ?, 1230, ?)`,
    questionId,
    participantId,
    choiceIndex,
    Date.now(),
  );

const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';

describe('部屋の DO の SQLite のスキーマ', () => {
  it('DO の起動時に、いまの版までマイグレーションが当たる', async () => {
    const stub = env.ROOM.getByName('schema-migrated');

    const { tables, version } = await runInDurableObject(stub, (_instance, state) => ({
      tables: state.storage.sql
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\'`,
        )
        .toArray()
        .map((row) => row.name),
      version: state.storage.sql
        .exec<{ version: number }>('SELECT max(version) AS version FROM schema_migrations')
        .one().version,
    }));

    expect(tables).toEqual(
      expect.arrayContaining(['room', 'questions', 'participants', 'answers', 'question_scores', 'schema_migrations']),
    );
    expect(version).toBe(ROOM_SCHEMA_VERSION);
  });

  it('マイグレーションをもう1度当てても、何も変わらない', async () => {
    const stub = env.ROOM.getByName('schema-migrate-twice');

    const versions = await runInDurableObject(stub, (_instance, state) => {
      migrate(state.storage);
      return state.storage.sql.exec<{ version: number }>('SELECT version FROM schema_migrations').toArray();
    });

    expect(versions).toHaveLength(ROOM_SCHEMA_VERSION);
  });

  it('同じ回答者が同じ問題に2回回答すると、UNIQUE(question_id, participant_id) で断られる（S4）', async () => {
    const stub = env.ROOM.getByName('schema-answers-unique');

    await runInDurableObject(stub, (_instance, state) => {
      const { sql } = state.storage;
      insertQuestion(sql, 'q1', 0);
      insertQuestion(sql, 'q2', 1);
      insertParticipant(sql, P1, 'たろう', 'たろう');
      insertParticipant(sql, P2, 'はなこ', 'はなこ');
      insertAnswer(sql, 'q1', P1, 0);

      expect(() => insertAnswer(sql, 'q1', P1, 1)).toThrow(/UNIQUE constraint failed/);
      // 別の問題・別の回答者なら通る
      expect(() => insertAnswer(sql, 'q2', P1, 1)).not.toThrow();
      expect(() => insertAnswer(sql, 'q1', P2, 1)).not.toThrow();
    });
  });

  it('正規化した名前が同じ回答者は、表示名が違っても入れない（F2）', async () => {
    const stub = env.ROOM.getByName('schema-name-unique');

    await runInDurableObject(stub, (_instance, state) => {
      const { sql } = state.storage;
      insertParticipant(sql, P1, 'ＴＡＲＯ', 'TARO');

      expect(() => insertParticipant(sql, P2, 'TARO ', 'TARO')).toThrow(/UNIQUE constraint failed/);
    });
  });

  it('いない回答者や問題への回答は、外部キーで断られる', async () => {
    const stub = env.ROOM.getByName('schema-answers-fk');

    await runInDurableObject(stub, (_instance, state) => {
      const { sql } = state.storage;
      insertQuestion(sql, 'q1', 0);

      expect(() => insertAnswer(sql, 'q1', P1, 0)).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  it('秘密のハッシュが32バイトでなければ入れない', async () => {
    const stub = env.ROOM.getByName('schema-token-hash');

    await runInDurableObject(stub, (_instance, state) => {
      expect(() =>
        state.storage.sql.exec(
          `INSERT INTO participants (participant_id, name, normalized_name, token_hash, joined_at) VALUES (?, 'a', 'a', ?, 0)`,
          P1,
          new Uint8Array(16),
        ),
      ).toThrow(/CHECK constraint failed/);
    });
  });

  it('部屋の行は1つだけで、段階は roomPhaseSchema の値しか入らない', async () => {
    const stub = env.ROOM.getByName('schema-room-row');

    await runInDurableObject(stub, (_instance, state) => {
      const { sql } = state.storage;
      insertRoom(sql);

      expect(() =>
        sql.exec(`INSERT INTO room (id, owner_id, title, phase, created_at) VALUES (2, 'o', 't', 'lobby', 0)`),
      ).toThrow(/CHECK constraint failed/);
      expect(() => sql.exec(`UPDATE room SET phase = 'playing'`)).toThrow(/CHECK constraint failed/);
    });
  });

  it('受付の締切の時刻（deadline_at）を持ち、部屋を作ったときは NULL になる（F9・v2）', async () => {
    const stub = env.ROOM.getByName('schema-deadline-at');

    const deadlines = await runInDurableObject(stub, (_instance, state) => {
      const { sql } = state.storage;
      insertRoom(sql);
      const before = sql.exec<{ deadline_at: number | null }>('SELECT deadline_at FROM room').one().deadline_at;
      sql.exec('UPDATE room SET deadline_at = ?', 12_345);
      const after = sql.exec<{ deadline_at: number | null }>('SELECT deadline_at FROM room').one().deadline_at;
      return { before, after };
    });

    expect(deadlines).toEqual({ before: null, after: 12_345 });
  });

  it('入室1回で書くのは参加者の1行だけで、得点の合計は確定した得点から求める（ADR 0004 の DD7）', async () => {
    const stub = env.ROOM.getByName('schema-join-one-row');

    await runInDurableObject(stub, (_instance, state) => {
      const { sql } = state.storage;
      insertRoom(sql);
      insertQuestion(sql, 'q1', 0);
      const countRows = () =>
        Object.fromEntries(
          ['room', 'questions', 'participants', 'answers', 'question_scores'].map((table) => [
            table,
            sql.exec<{ n: number }>(`SELECT count(*) AS n FROM ${table}`).one().n,
          ]),
        );
      const before = countRows();

      insertParticipant(sql, P1, 'たろう', 'たろう');

      expect(countRows()).toEqual({ ...before, participants: before.participants + 1 });
      // 得点の行がなくても、合計は0点になる
      const totals = sql
        .exec<{ participant_id: string; join_order: number; total_score: number }>(
          `SELECT p.participant_id, p.join_order, coalesce(sum(s.points), 0) AS total_score
             FROM participants p LEFT JOIN question_scores s ON s.participant_id = p.participant_id
            GROUP BY p.participant_id ORDER BY p.join_order`,
        )
        .toArray();
      expect(totals).toEqual([{ participant_id: P1, join_order: 1, total_score: 0 }]);
    });
  });

  it('DO を休止させても、表と行が残る（A3）', async () => {
    const stub = env.ROOM.getByName('schema-evict');

    await runInDurableObject(stub, (_instance, state) => {
      const { sql } = state.storage;
      insertRoom(sql);
      insertQuestion(sql, 'q1', 0);
      insertParticipant(sql, P1, 'たろう', 'たろう');
      insertAnswer(sql, 'q1', P1, 0);
      sql.exec(`INSERT INTO question_scores (question_id, participant_id, points) VALUES ('q1', ?, 938)`, P1);
      sql.exec(`UPDATE questions SET closed_at = 1 WHERE id = 'q1'`);
    });

    await evictDurableObject(stub);

    // 休止のあとは新しいインスタンスがコンストラクタからやり直し、マイグレーションをもう1度通る
    const rows = await runInDurableObject(stub, (_instance, state) => {
      const { sql } = state.storage;
      return {
        participants: sql.exec('SELECT participant_id FROM participants').toArray(),
        answers: sql.exec('SELECT question_id, participant_id, choice_index FROM answers').toArray(),
        scores: sql.exec('SELECT question_id, participant_id, points FROM question_scores').toArray(),
        closedAt: sql.exec<{ closed_at: number }>(`SELECT closed_at FROM questions WHERE id = 'q1'`).one().closed_at,
      };
    });

    expect(rows).toEqual({
      participants: [{ participant_id: P1 }],
      answers: [{ question_id: 'q1', participant_id: P1, choice_index: 0 }],
      scores: [{ question_id: 'q1', participant_id: P1, points: 938 }],
      closedAt: 1,
    });
  });
});

describe('接続の attachment の型（ADR 0003・0004）', () => {
  it('ホスト・回答者・未確認（null）の3つの形をとる', () => {
    expectTypeOf<Attachment>().toEqualTypeOf<
      { role: 'host'; ownerId: string } | { role: 'player'; participantId: string } | null
    >();
  });
});
