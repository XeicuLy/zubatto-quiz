import { useEffect, useLayoutEffect, useState } from 'react';

import { answerStartOf, remainingMsAt } from './answer-timer';

export interface Countdown {
  /** 計測の起点（performance.now() の値）。選択肢を描く直前のフレームで決まるまでは null */
  startedAt: number | null;
  /** 締切までの残り。起点が決まるまでは、届いた残りのまま */
  leftMs: number;
  /** 次に描き直すまでの時間。残り時間の棒を、この時間をかけて縮める */
  nextTickMs: number;
}

/**
 * 受付中の残り時間を数える。回答者の回答の画面と、ホストの進行画面の両方で使う。
 * 秒の変わり目ごとに描き直すので、締切の瞬間にもちょうど0になる。
 * 受付中だけ描く部品の中で呼ぶ。部品を作り直すと、数え始めもやり直す
 */
export function useCountdown(limitMs: number, remainingMs: number): Countdown {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useLayoutEffect(() => {
    // useLayoutEffect は中身を DOM に入れたあと、描く前に動く。
    // ここで頼んだ requestAnimationFrame は、初めて描くフレームの直前に呼ばれるので、その時刻を表示の瞬間とする
    const frame = requestAnimationFrame(() => {
      const shownAt = performance.now();
      setStartedAt(answerStartOf(shownAt, limitMs, remainingMs));
      setNow(shownAt);
    });
    return () => cancelAnimationFrame(frame);
  }, [limitMs, remainingMs]);

  const leftMs = startedAt === null || now === null ? remainingMs : remainingMsAt(startedAt, limitMs, now);
  const nextTickMs = leftMs % 1000 || 1000;

  useEffect(() => {
    if (startedAt === null || leftMs === 0) {
      return;
    }
    const timer = setTimeout(() => setNow(performance.now()), nextTickMs);
    return () => clearTimeout(timer);
  }, [startedAt, leftMs, nextTickMs]);

  return { startedAt, leftMs, nextTickMs };
}
