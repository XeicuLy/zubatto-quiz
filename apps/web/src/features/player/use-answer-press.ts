import type { Answer } from '@zubatto-quiz/protocol';
import { useRef, useState } from 'react';

import type { CurrentQuestion } from '@/realtime/room-store';
import { elapsedMsAt, remainingMsAt } from '@/shared/countdown/answer-timer';

export interface AnswerPressOptions {
  questionId: string;
  limitMs: number;
  /** 計測の起点（useCountdown の startedAt）。選択肢を描く前の null のあいだは、押しても送らない */
  startedAt: number | null;
  /** player-room の answer。送れなかったら false を返す */
  onAnswer: (answer: Omit<Answer, 'type'>) => boolean;
}

export interface AnswerPress {
  /** 選択肢を押したときに呼ぶ。押した瞬間を測り、1回だけ送る */
  press: (choiceIndex: number) => void;
  /** 押した瞬間に出す回答。answerAccepted が届いたら、呼び出し側はそちらを使う */
  pending: CurrentQuestion['answer'];
}

/**
 * 回答の押下（P2・F10）。押した瞬間の時刻を起点からの経過にして、1回だけ送る。
 * 受付中だけ描く部品の中で呼ぶ。やり直し（retryQuestion）で部品が捨てられると、二度押しの印も消える
 */
export function useAnswerPress({ questionId, limitMs, startedAt, onAnswer }: AnswerPressOptions): AnswerPress {
  const [pending, setPending] = useState<CurrentQuestion['answer']>(null);
  /** 二度押しの印。state は次の描画まで変わらないので、同じフレームの2回目の押下を止めるには ref が要る */
  const sent = useRef(false);

  function press(choiceIndex: number) {
    if (sent.current || startedAt === null) {
      return;
    }
    // 時刻はイベントの中でだけ読む。描画の中で読むと、描くたびに値が変わる
    const pressedAt = performance.now();
    // 最後の描き直しのあとで締切を過ぎていたら送らない。送っても not_accepting で断られる
    if (remainingMsAt(startedAt, limitMs, pressedAt) === 0) {
      return;
    }
    const mine = { choiceIndex, elapsedMs: elapsedMsAt(startedAt, pressedAt) };
    // 接続が開いていなければ送れていないので、印を付けずに押し直せるままにする
    if (!onAnswer({ questionId, ...mine })) {
      return;
    }
    sent.current = true;
    setPending(mine);
  }

  return { press, pending };
}
