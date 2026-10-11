import {
  MAX_CHOICES,
  MAX_LIMIT_MS,
  MAX_QUESTIONS,
  MIN_CHOICES,
  MIN_LIMIT_MS,
  roomPhaseSchema,
} from '@zubatto-quiz/protocol';

/**
 * 部屋の DO の SQLite の表（ADR 0001）。部屋の状態・回答・得点の正本になる。
 *
 * drizzle は使わず、ctx.storage.sql に SQL をそのまま渡す。sql.exec は同期で動くので、
 * join の確認と挿入を await なしで行える（ADR 0004）。時刻はどれも Unix のミリ秒。
 *
 * 一度デプロイした版の SQL は書き換えない。変えるときは ROOM_MIGRATIONS の末尾に新しい版を足す。
 * 部屋は数時間で終わるが、デプロイの前に作った部屋の DO も、次に起きたときに新しい版を当てる。
 */

// CHECK の中では ? の引数を使えないので、protocol の値を SQL の文字としてそのまま埋める
const phases = roomPhaseSchema.options.map((phase) => `'${phase}'`).join(', ');

const v1 = `
-- 部屋。1つの DO に1部屋なので、行は id = 1 の1つだけ
CREATE TABLE room (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- 部屋を作ったホストの Better Auth の user.id（ADR 0003）。ホスト用の接続はこれと比べる
  owner_id TEXT NOT NULL,
  -- 問題セットのタイトル。作成のときに D1 からコピーする（ADR 0002）
  title TEXT NOT NULL,
  -- 進行の段階（protocol の roomPhaseSchema）
  phase TEXT NOT NULL CHECK (phase IN (${phases})),
  -- 今の問題（questions.position）。lobby のときは NULL
  current_position INTEGER,
  created_at INTEGER NOT NULL,
  -- 部屋を終えた時刻。終わっていなければ NULL。resume は終わった部屋では通さない（ADR 0004）
  ended_at INTEGER
) STRICT;

-- D1 からコピーした問題（ADR 0002）。正解を含むので、締切まで DO の外へ出さない（S2）
CREATE TABLE questions (
  -- D1 の questions.id をそのまま使う。メッセージの questionId になる
  id TEXT PRIMARY KEY,
  -- 何問目か（0始まり）
  position INTEGER NOT NULL UNIQUE CHECK (position BETWEEN 0 AND ${MAX_QUESTIONS - 1}),
  -- Markdown（F5）
  text TEXT NOT NULL,
  -- 選択肢の文字列の JSON の配列。D1 の CHECK を通ったものだけが来るので、数だけを確かめる
  choices TEXT NOT NULL CHECK (json_array_length(choices) BETWEEN ${MIN_CHOICES} AND ${MAX_CHOICES}),
  correct_index INTEGER NOT NULL CHECK (correct_index >= 0 AND correct_index < json_array_length(choices)),
  limit_ms INTEGER NOT NULL CHECK (limit_ms BETWEEN ${MIN_LIMIT_MS} AND ${MAX_LIMIT_MS}),
  -- 締切の集計を終えて得点を確定した時刻。まだなら NULL。
  -- alarm が2回動いても、確定した問題は集計し直さない。障害のあとは、確定していない問題からやり直す（A3）
  closed_at INTEGER
) STRICT;

-- 回答者。入室1回につき、この表に1行だけ書く（ADR 0004 の DD7）。得点の合計は question_scores から求めるので、ここには持たない
CREATE TABLE participants (
  -- 入室した順。rowid の別名なので、挿入するだけで決まる。同じ順位の人を並べるときに使う（scoring の joinOrder）
  join_order INTEGER PRIMARY KEY,
  -- crypto.randomUUID()。attachment とメッセージで使う
  participant_id TEXT NOT NULL UNIQUE,
  -- 表示名。ランキングや参加者一覧に出す
  name TEXT NOT NULL,
  -- NFKC で正規化して前後の空白を除いた名前。かぶりをこの一意制約で止める（F2）
  normalized_name TEXT NOT NULL UNIQUE,
  -- 秘密の SHA-256。秘密そのものは持たない（ADR 0004）
  token_hash BLOB NOT NULL CHECK (length(token_hash) = 32),
  -- resume は入室から6時間までしか通さない（ADR 0004）
  joined_at INTEGER NOT NULL
) STRICT;

-- 回答。1人1問1回を UNIQUE で止める（S4）。受付中かの確認と同じトランザクションで書く
CREATE TABLE answers (
  question_id TEXT NOT NULL REFERENCES questions (id),
  -- attachment の participantId。メッセージの中の値は使わない（ADR 0004）
  participant_id TEXT NOT NULL REFERENCES participants (participant_id),
  choice_index INTEGER NOT NULL CHECK (choice_index BETWEEN 0 AND ${MAX_CHOICES - 1}),
  -- normalizeElapsedMs で制限時間に収め、0.01秒単位に切り捨てた経過時間（P2）
  elapsed_ms INTEGER NOT NULL CHECK (elapsed_ms BETWEEN 0 AND ${MAX_LIMIT_MS}),
  -- DO が受け取った時刻
  received_at INTEGER NOT NULL,
  UNIQUE (question_id, participant_id)
) STRICT;

-- 締切で確定した問題ごとの得点（A3）。回答した人の行だけを書き、回答しなかった人は0点として扱う。
-- 点は packages/scoring で計算した値をそのまま入れ、DO では計算しない
CREATE TABLE question_scores (
  question_id TEXT NOT NULL REFERENCES questions (id),
  participant_id TEXT NOT NULL REFERENCES participants (participant_id),
  points INTEGER NOT NULL CHECK (points >= 0),
  PRIMARY KEY (question_id, participant_id)
) STRICT, WITHOUT ROWID;
`;

/** 版ごとの SQL。配列の位置 + 1 が版の番号になる */
export const ROOM_MIGRATIONS: readonly string[] = [v1];

/** 最新の版 */
export const ROOM_SCHEMA_VERSION = ROOM_MIGRATIONS.length;
