import * as z from 'zod';

/**
 * サーバーが WebSocket を閉じるときの code。reason にはキーの文字列（例: 'join_timeout'）を入れる。
 * 端末は reason ではなく code で見分ける。
 *
 * - 番号は、アプリが自由に使える 4000〜4999 の中で、4000 に意味の近い HTTP の状態コードを足して付ける（ADR 0004）
 * - 自動で再接続するのは join_timeout と connection_limit だけ。ほかは画面に理由を出して止まる
 */
export const CLOSE_CODES = {
  /** 同じ回答者が別のタブでつないだので、古いほうを閉じた（301 Moved Permanently）。自動で再接続しない */
  replaced: 4301,
  /** resume の秘密が合わない、入室から6時間を過ぎた、などで戻れない（401 Unauthorized）。端末は秘密を消し、名前の入力から入り直す */
  resume_failed: 4401,
  /** 部屋の回答者が上限の50名に達している（403 Forbidden, SC1） */
  room_full: 4403,
  /**
   * 部屋がない。ホスト用の入口では、持ち主でないホストにも同じ code を返し、他人の部屋があることを知らせない（404 Not Found, S1）。
   * 端末は秘密を消し、つなぎ直さない
   */
  room_not_found: 4404,
  /** 未確認の接続が、10秒以内に join も resume も送らなかった（408 Request Timeout, T5）。間を空けて自動で再接続する */
  join_timeout: 4408,
  /** 同じ部屋に、NFKC で正規化して同じになる名前がある（409 Conflict, F2）。別の名前を入れてもらう */
  name_taken: 4409,
  /** 部屋が終わった（410 Gone） */
  room_ended: 4410,
  /** 部屋の接続が上限（回答者用の100本、ホスト用の5本）に達している（503 Service Unavailable）。一時的なので、間を空けて自動で再接続する */
  connection_limit: 4503,
} as const satisfies Record<string, number>;

export type CloseReason = keyof typeof CLOSE_CODES;
export type CloseCode = (typeof CLOSE_CODES)[CloseReason];

/** JSON Schema に書き出すための形。Go へ置き換えるときは、ここから番号と理由を写す */
export const closeCodeSchema = z.union(
  Object.entries(CLOSE_CODES).map(([reason, code]) => z.literal(code).meta({ title: reason })),
);
