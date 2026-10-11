import { DurableObject } from 'cloudflare:workers';

import { migrate } from './migrate';

/**
 * 1部屋につき1つ作る Durable Object。部屋の状態・得点・回答の唯一の正本になる（ADR 0001）。
 * 表は schema.ts、接続ごとの情報は attachment.ts にある。
 *
 * WebSocket は Hibernation API で受ける。接続を受け付ける処理とハンドラの中身は、T18 以降で書く。
 */
export class RoomDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 休止から起きたときも、ここを通ってから WebSocket のハンドラが呼ばれる。
    // マイグレーションが終わるまで、ほかの要求を受けない。失敗すれば DO が作り直され、次の要求でやり直す
    void ctx.blockConcurrencyWhile(async () => migrate(ctx.storage));
  }

  override async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {}

  override async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {}

  override async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {}
}
