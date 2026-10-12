import { CLOSE_CODES } from '@zubatto-quiz/protocol';

/**
 * つなぎ直すときの決まり。切れたあと、いつ・どの理由ならつなぎ直すかを、ここだけで決める。
 */

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

/**
 * attempt 回目（0から数える）のつなぎ直しの前に待つミリ秒。
 * 倍々に延ばして30秒で止め、半分から全部までのあいだでばらつかせる。
 * デプロイで50人が一斉に切れても、同じ瞬間に部屋の DO へつなぎ直さないようにする
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt) * (0.5 + random() / 2);
}

/**
 * サーバーが閉じたときの code で、自動でつなぎ直すかを決める（ADR 0004）。
 * 端末が自分で close() したときは、connectRoom がここを呼ばずに止まる
 */
export function shouldReconnect(code: number): boolean {
  // アプリの code（4000〜4999）でなければ、デプロイや回線切れで一時的に切れただけなので、つなぎ直す。
  // アプリの code では、一時的に断られた join_timeout と connection_limit だけつなぎ直す。
  // ほかは、つなぎ直しても同じ理由で閉じられる（replaced なら2つのタブが閉じ合い続ける）
  return !(code >= 4000 && code < 5000) || code === CLOSE_CODES.join_timeout || code === CLOSE_CODES.connection_limit;
}
