import { nextPendingDeadline } from './pending-timeout';

/** 受付中の問題の締切（F9）。受付中でなければ null */
export const readAnsweringDeadline = (sql: SqlStorage): number | null =>
  sql.exec<{ deadline_at: number | null }>('SELECT deadline_at FROM room').toArray()[0]?.deadline_at ?? null;

/**
 * 次に alarm で起きる時刻を、今の状態から計算し直して予定する（ADR 0004）。
 * 時刻は、締切と、一番早く閉じる未確認の接続の時刻のうち、早いほう。
 * DO の alarm は1つしかなく、setAlarm は前の予定を上書きする。getAlarm() で読んだ予定に頼らず、毎回計算し直すので、
 * 片方の予定を消さずに済む。呼ぶのは、未確認の接続を受け付けたとき、受付を始めたとき、alarm の処理の最後の3か所。
 *
 * setAlarm は await しない。fetch と進行操作を同期のままにするためで、書き込みが終わるまで応答は端末に届かない（出力ゲート）
 */
export function scheduleAlarm(ctx: DurableObjectState): void {
  const times = [nextPendingDeadline(ctx), readAnsweringDeadline(ctx.storage.sql)].filter((time) => time !== null);
  void (times.length === 0 ? ctx.storage.deleteAlarm() : ctx.storage.setAlarm(Math.min(...times)));
}
