/**
 * 回答時間の計測（P2）。時刻は performance.now() の値を引数で受け取り、ここでは読まない。
 * 回線の速さで不公平にならないよう、端末で、選択肢が表示された瞬間から押すまでを測る
 */

/**
 * 計測の起点。ふだんは remainingMs が limitMs と同じなので、選択肢を表示した瞬間になる。
 * 受付中につなぎ直すと、部屋の DO は残りを短くして送り直す。切れていたあいだも時間は進んでいたので、
 * そのぶん起点を前にずらす。ずらさないと、つなぎ直した人だけ回答時間が短く測られる
 */
export function answerStartOf(shownAt: number, limitMs: number, remainingMs: number): number {
  return shownAt - (limitMs - remainingMs);
}

/**
 * 送る回答時間。protocol は0以上の整数のミリ秒を求める。
 * サーバーは0.01秒単位に切り捨てる（normalizeElapsedMs）ので、ここも四捨五入ではなく切り捨てにする。
 * 四捨五入だと 1009.6 ms が 1010 ms になり、1.00秒のはずが1.01秒に繰り上がる
 */
export function elapsedMsAt(startedAt: number, now: number): number {
  return Math.max(0, Math.floor(now - startedAt));
}

/** 締切までの残りのミリ秒。締切を過ぎたら0 */
export function remainingMsAt(startedAt: number, limitMs: number, now: number): number {
  return Math.max(0, startedAt + limitMs - now);
}
