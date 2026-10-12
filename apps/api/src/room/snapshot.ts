import type { Participants, RoomPhase, RoomSnapshot } from '@zubatto-quiz/protocol';

/** 部屋の今の状態の要約を、SQLite から同期で読む。joined・resumed・hostReady に入れる */
export function readRoomSnapshot(sql: SqlStorage): RoomSnapshot {
  const room = sql
    .exec<{ title: string; phase: RoomPhase; current_position: number | null }>(
      'SELECT title, phase, current_position FROM room',
    )
    .one();
  const { count } = sql.exec<{ count: number }>('SELECT count(*) AS count FROM questions').one();
  return { title: room.title, questionCount: count, phase: room.phase, questionIndex: room.current_position };
}

/** 参加者一覧（F3）。入室した順に並べる。秘密のハッシュや正規化した名前は読まない */
export const readParticipants = (sql: SqlStorage): Participants['participants'] =>
  sql
    .exec<{ participantId: string; name: string }>(
      'SELECT participant_id AS participantId, name FROM participants ORDER BY join_order',
    )
    .toArray();
