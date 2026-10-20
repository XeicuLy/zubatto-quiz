import type { RoomState } from '../../realtime/room-store';

/**
 * ホストが部屋を終えたとき、部屋がどこまで進んでいたか（#97）。
 * - after_final: 最終ランキングを出したあと。閉じたあとも、手元に最終ランキングを残す
 * - midway: それより前（待機・出題・結果の途中）。発表した最終の結果はない
 * - not_entered: 部屋に入る前に断られた（終わったあとの読み込み直し・あとから URL を開いた）
 */
export type RoomEnd = 'after_final' | 'midway' | 'not_entered';

/**
 * room_ended で閉じたあとの段階を、残っているその回のストアから読む。room_ended で閉じていなければ null。
 * 部屋の DO は、終わった部屋への join・resume・ホストの接続も room_ended で閉じるので、room が null のこともある
 */
export function roomEndOf({
  connection,
  closeReason,
  room,
  finalRanking,
}: Pick<RoomState, 'connection' | 'closeReason' | 'room' | 'finalRanking'>): RoomEnd | null {
  if (connection !== 'closed' || closeReason !== 'room_ended') return null;
  if (room === null) return 'not_entered';
  return room.phase === 'final' && finalRanking !== null ? 'after_final' : 'midway';
}
