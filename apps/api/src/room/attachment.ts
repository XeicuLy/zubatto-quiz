/**
 * WebSocket の接続ごとに残す情報（Hibernation API の attachment）。休止のあとも残る。
 * - host: 部屋の持ち主と確かめたホスト用の接続（ADR 0003）。進行操作はこの接続からだけ受け付ける
 * - player: join か resume が通った回答者用の接続（ADR 0004）。回答の participantId はここから取る
 * - null: 未確認の接続。join と resume しか受け付けない（ADR 0004）
 */
export type Attachment = { role: 'host'; ownerId: string } | { role: 'player'; participantId: string } | null;

/** attachment を読む。まだ何も記録していない接続は null（未確認）になる */
export const getAttachment = (ws: WebSocket): Attachment => ws.deserializeAttachment() as Attachment;

/** 確かめた接続に attachment を記録する。未確認へ戻すことはしないので、null は受け取らない */
export const setAttachment = (ws: WebSocket, attachment: NonNullable<Attachment>): void => {
  ws.serializeAttachment(attachment);
};
