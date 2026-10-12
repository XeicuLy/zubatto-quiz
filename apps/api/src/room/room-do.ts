import { DurableObject } from 'cloudflare:workers';

import type { StoredQuestion } from '../question-sets/repository';
import { acceptConnection, readRoomEntry } from './connections';
import { migrate } from './migrate';

/** initialize に渡す値。部屋の作成で D1 から1回だけ読んだ、問題セットの全体（正解を含む）と持ち主 */
export type RoomInit = { ownerId: string; title: string; questions: readonly StoredQuestion[] };

/**
 * 1部屋につき1つ作る Durable Object。部屋の状態・得点・回答の唯一の正本になる（ADR 0001）。
 * 表は schema.ts、接続ごとの情報は attachment.ts にある。
 *
 * WebSocket は Hibernation API で受ける。受け付けと本数の上限は connections.ts にある。ハンドラの中身は T19 以降で書く。
 */
export class RoomDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 休止から起きたときも、ここを通ってから WebSocket のハンドラが呼ばれる。
    // マイグレーションが終わるまで、ほかの要求を受けない。失敗すれば DO が作り直され、次の要求でやり直す
    void ctx.blockConcurrencyWhile(async () => migrate(ctx.storage));
  }

  /**
   * 部屋を作るときに1回だけ呼ぶ RPC（ADR 0002）。持ち主と問題セットの写しを、1つのトランザクションで書く。
   *
   * ここで書いた問題が、この部屋の正本になる。このあとは D1 を読まないので、元の問題セットを編集しても部屋は変わらない（F7）。
   * 途中で失敗したら何も残らない。2回目の呼び出しは断り、1回目の持ち主と問題を書き換えさせない
   */
  initialize({ ownerId, title, questions }: RoomInit): void {
    const { sql } = this.ctx.storage;
    // 中で例外が出れば、それまでに書いた行もまとめて取り消される
    this.ctx.storage.transactionSync(() => {
      // 1. room の表にもう行があれば、2回目の初期化なので断る
      const { count } = sql.exec<{ count: number }>('SELECT count(*) AS count FROM room').one();
      if (count > 0) {
        throw new Error('部屋はもう作られている');
      }

      // 2. 部屋の1行を書く。current_position と ended_at は NULL のまま
      sql.exec(
        'INSERT INTO room (id, owner_id, title, phase, created_at) VALUES (1, ?, ?, ?, ?)',
        ownerId,
        title,
        'lobby',
        Date.now(),
      );

      // 3. 問題を1問ずつ書く。entries() は [添字, 要素] を返すので、添字を position にする
      for (const [position, question] of questions.entries()) {
        sql.exec(
          'INSERT INTO questions (id, position, text, choices, correct_index, limit_ms) VALUES (?, ?, ?, ?, ?, ?)',
          question.id,
          position,
          question.text,
          JSON.stringify(question.choices),
          question.correctIndex,
          question.limitMs,
        );
      }
    });
  }

  /**
   * WebSocket の接続を受け付ける。Worker が Origin・部屋 ID・ホストのセッションを確かめたあと、roomRequest で作った要求だけが来る。
   *
   * async にせず、await を1つも書かない。本数の確認から acceptWebSocket までに、別の接続が割り込まないようにするため（ADR 0004）
   */
  override fetch(request: Request): Response {
    const entry = readRoomEntry(request);
    // initialize の済んでいない ID でも DO はでき、room の表が空になる。ない部屋として断る
    const room = this.ctx.storage.sql.exec<{ owner_id: string }>('SELECT owner_id FROM room').toArray()[0];
    if (!entry || !room) {
      return new Response(null, { status: 404 });
    }

    if (entry.role === 'player') {
      return acceptConnection(this.ctx, null);
    }
    // ホスト用の入口。Worker がセッションから決めた ownerId が、部屋の持ち主と一致したときだけ host として受け付ける（S1・ADR 0003）。
    // 他人の部屋は、ない部屋と同じ 404 にする（HTTP API と同じ）
    if (entry.ownerId !== room.owner_id) {
      return new Response(null, { status: 404 });
    }
    return acceptConnection(this.ctx, entry);
  }

  override async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {}

  override async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {}

  override async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {}
}
