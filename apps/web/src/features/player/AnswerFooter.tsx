import { formatSeconds, normalizeElapsedMs } from '@zubatto-quiz/scoring';

import type { CurrentQuestion } from '@/realtime/room-store';

type MyAnswer = CurrentQuestion['answer'];

interface AnswerFooterProps {
  /** 自分の回答。答えていなければ null */
  answer: MyAnswer;
  limitMs: number;
  /** 締切になったか */
  closed: boolean;
}

/**
 * 回答済みと締切の知らせ。時間はサーバーと同じく0.01秒単位に切り捨てて出す。
 * 押したときに箱ごと現れるので role="status" は付けず、読み上げは受付中の画面が answerAnnouncementOf の文を渡す
 */
export function AnswerFooter({ answer, limitMs, closed }: AnswerFooterProps) {
  return (
    <div className="mt-auto pt-8 text-center">
      {answer !== null && (
        <>
          <p className="text-muted-foreground">回答までの時間</p>
          <p className="text-display font-bold tabular-nums">
            {secondsOf(answer.elapsedMs, limitMs)}
            <span className="ml-1 text-heading">秒</span>
          </p>
        </>
      )}
      <p className="mt-4 font-bold text-muted-foreground">{closed ? '締切になりました' : '締切を待っています'}</p>
    </div>
  );
}

/**
 * AnswerFooter と同じことを読み上げる文。締切になったら、時間はもう読んだので締切だけを言う。
 * フォーカスの移った一覧では名前と項目数しか読まれないので、選んだものもここで言う
 */
export function answerAnnouncementOf(
  answer: MyAnswer,
  choices: string[],
  limitMs: number,
  closed: boolean,
): string | null {
  if (closed) {
    return '締切になりました';
  }
  if (answer === null) {
    return null;
  }
  const { choiceIndex, elapsedMs } = answer;
  return `${choiceIndex + 1}番「${choices[choiceIndex]}」で回答しました。回答までの時間 ${secondsOf(elapsedMs, limitMs)}秒。締切を待っています`;
}

function secondsOf(elapsedMs: number, limitMs: number): string {
  return formatSeconds(normalizeElapsedMs(elapsedMs, limitMs));
}
