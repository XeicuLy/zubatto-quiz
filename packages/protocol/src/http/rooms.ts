import * as z from 'zod';

/**
 * 部屋を作る HTTP API（/api/rooms）の要求と応答の形（F1・ADR 0002）。ホストだけが使える（S1）。
 *
 * - POST /api/rooms  CreateRoomRequest → 201 CreateRoomResponse
 *
 * 自分の問題セットから部屋を作る。他人のセットとないセットは、どちらも 404 にする。
 * エラーは http/errors.ts の形で返す
 */

/**
 * 部屋の ID。推測できない64桁の16進（S3）。参加用の URL と WebSocket の経路に入る。
 * Go へ置き換えるときも、32バイトの乱数を16進にすれば同じ形になる
 */
export const roomIdSchema = z.string().regex(/^[0-9a-f]{64}$/);
export type RoomId = z.infer<typeof roomIdSchema>;

export const createRoomRequestSchema = z.object({ questionSetId: z.uuid() });
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;

export const createRoomResponseSchema = z.object({
  roomId: roomIdSchema,
  /** 回答者に共有する参加用の URL（F1・F2）。画面の Worker のオリジンの /r/:roomId */
  joinUrl: z.url(),
});
export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;
