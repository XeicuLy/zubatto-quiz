import { decodeClientMessage, isHostCommand } from '@zubatto-quiz/protocol';
import { DurableObject } from 'cloudflare:workers';

import type { StoredQuestion } from '../question-sets/repository';
import { scheduleAlarm } from './alarm';
import { getAttachment } from './attachment';
import { acceptConnection, readRoomEntry, refuseConnection } from './connections';
import { handleAnswer } from './handlers/answer';
import { closeAnsweringIfDue, handleHostCommand } from './handlers/host-commands';
import { handleJoin } from './handlers/join';
import { handleResume } from './handlers/resume';
import { migrate } from './migrate';
import { closeExpiredPending } from './pending-timeout';
import { resendCurrentPhase } from './resend';
import { send } from './send';
import { readParticipants, readRoomSnapshot } from './snapshot';

/** initialize に渡す値。部屋の作成で D1 から1回だけ読んだ、問題セットの全体（正解を含む）と持ち主 */
export type RoomInit = { ownerId: string; title: string; questions: readonly StoredQuestion[] };

/**
 * 1部屋につき1つ作る Durable Object。部屋の状態・得点・回答の唯一の正本になる（ADR 0001）。
 * 表は schema.ts、接続ごとの情報は attachment.ts にある。
 *
 * WebSocket は Hibernation API で受ける。受け付けと本数の上限は connections.ts、メッセージごとの処理は handlers/ にある。
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
    // roomRequest が作った要求でなければ、Worker の作りの誤り。端末からは来ないので、HTTP の 404 で断る
    if (!entry) {
      return new Response(null, { status: 404 });
    }
    // initialize の済んでいない ID でも DO はでき、room の表が空になる。ない部屋として断る。
    // HTTP の 404 で断ると、ブラウザには 1006 にしか見えず、端末がつなぎ直し続けるので、受け付けてから code で閉じる
    const { sql } = this.ctx.storage;
    const room = sql
      .exec<{ owner_id: string; ended_at: number | null }>('SELECT owner_id, ended_at FROM room')
      .toArray()[0];
    if (!room) {
      return refuseConnection('room_not_found');
    }

    if (entry.role === 'player') {
      const { response } = acceptConnection(this.ctx, null);
      // 受け付けた未確認の接続を時間切れで閉じられるよう、alarm を予定し直す
      scheduleAlarm(this.ctx);
      return response;
    }
    // ホスト用の入口。Worker がセッションから決めた ownerId が、部屋の持ち主と一致したときだけ host として受け付ける（S1・ADR 0003）。
    // 他人の部屋は、ない部屋と同じ 4404 にする（HTTP API の 404 と同じ）。終わったかどうかも知らせないよう、先に確かめる
    if (entry.ownerId !== room.owner_id) {
      return refuseConnection('room_not_found');
    }
    // 終えた部屋は進められない。join・resume と同じ理由で閉じ、まだ続いているように見せない
    if (room.ended_at !== null) {
      return refuseConnection('room_ended');
    }
    const { response, accepted } = acceptConnection(this.ctx, entry);
    // 上限を超えて閉じた接続には送らない。101 を返す前に送っても、端末には開いたあとに届く
    if (accepted) {
      send(accepted, { type: 'hostReady', room: readRoomSnapshot(sql) });
      send(accepted, { type: 'participants', participants: readParticipants(sql) });
      resendCurrentPhase(this.ctx, accepted, Date.now());
    }
    return response;
  }

  /**
   * 端末からのメッセージを、protocol の zod で確かめてから、接続の attachment で振り分ける。
   * 休止から起きたときも、attachment は残っているので、同じ接続を同じ回答者として扱える（A1）
   */
  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const decoded = decodeClientMessage(raw);
    if (!decoded.success) {
      send(ws, { type: 'error', code: 'invalid_message' });
      return;
    }
    const message = decoded.data;

    // 未確認の接続からは join と resume だけを受け付ける（ADR 0004）
    const attachment = getAttachment(ws);
    if (attachment === null) {
      if (message.type === 'join') {
        return handleJoin(this.ctx, ws, message);
      }
      if (message.type === 'resume') {
        return handleResume(this.ctx, ws, message);
      }
      send(ws, { type: 'error', code: 'not_verified' });
      return;
    }

    // 進行操作は、attachment の role が host の接続からだけ受け付ける（S1・ADR 0003）。
    // 操作のたびに D1 を見ず、接続を開くときに書いた attachment だけで決める（P1）
    if (isHostCommand(message)) {
      if (attachment.role !== 'host') {
        send(ws, { type: 'error', code: 'not_host' });
        return;
      }
      return handleHostCommand(this.ctx, ws, message);
    }

    // 回答は回答者の接続からだけ受け付け、participantId は attachment から取る。
    // 本文に participantId を書いても decode が取り除くので、他人として答えられない（S4・ADR 0004）
    if (message.type === 'answer' && attachment.role === 'player') {
      return handleAnswer(this.ctx, ws, attachment.participantId, message);
    }
    // 確かめ済みの接続は、もう join も resume もできない。ホストの接続は回答者ではないので、回答もできない
    send(ws, { type: 'error', code: 'invalid_state' });
  }

  /**
   * 時間を過ぎた未確認の接続を閉じ、締切を過ぎた受付を締め切ってから、次の alarm を予定し直す（ADR 0004）。
   * alarm は少なくとも1回動き、2回動くこともある。閉じた接続も、締め切った問題も、2回目には何もしないので、結果は変わらない
   */
  override alarm(): void {
    const now = Date.now();
    closeExpiredPending(this.ctx, now);
    closeAnsweringIfDue(this.ctx, now);
    scheduleAlarm(this.ctx);
  }

  override async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {}

  override async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {}
}
