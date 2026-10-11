import { DurableObject } from 'cloudflare:workers';

/**
 * 1部屋につき1つ作る Durable Object。部屋の状態・得点・回答の唯一の正本になる（ADR 0001）。
 *
 * WebSocket は Hibernation API で受ける。接続を受け付ける処理とハンドラの中身は、T18 以降で書く。
 */
export class RoomDurableObject extends DurableObject<Env> {
  override async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {}

  override async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {}

  override async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {}
}
