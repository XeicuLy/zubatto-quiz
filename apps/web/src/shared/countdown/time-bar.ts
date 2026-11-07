/** 残り時間の棒に渡す値。TimeBar はこれを描くだけにする */
export interface TimeBarValue {
  /** 残りの割合（0〜1） */
  ratio: number;
  /** ratio の幅まで縮むのにかける時間 */
  transitionMs: number;
}

/**
 * 棒の値。数え始めたら、次に描き直すときの残りへ、それまでの時間をかけて縮める。
 * 棒は秒の変わり目を待たずになめらかに減り、締切の瞬間にちょうど0になる。
 * 起点が決まるまでは、届いた残りの割合で止めておく
 */
export function timeBarOf(
  limitMs: number,
  { startedAt, leftMs, nextTickMs }: { startedAt: number | null; leftMs: number; nextTickMs: number },
): TimeBarValue {
  if (startedAt === null) {
    return { ratio: leftMs / limitMs, transitionMs: 0 };
  }
  return { ratio: (leftMs - nextTickMs) / limitMs, transitionMs: nextTickMs };
}
