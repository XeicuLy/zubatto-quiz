import type { Answer, RoomPhase } from '@zubatto-quiz/protocol';

import { useAnnouncement } from '@/components/a11y/announce';
import type { CurrentQuestion } from '@/realtime/room-store';
import { useCountdown } from '@/shared/countdown/use-countdown';

import { AnswerButtons } from './AnswerButtons';
import { AnswerFooter, answerAnnouncementOf } from './AnswerFooter';
import { QuestionFrame } from './QuestionFrame';
import { useAnswerPress } from './use-answer-press';

export interface QuestionViewProps {
  question: CurrentQuestion;
  /** 部屋の段階。lobby と final は渡さない */
  phase: RoomPhase;
  questionCount: number;
  /** 自分の名前。受付の前のヘッダーに出す */
  name: string;
  /** player-room の answer。送れなかったら false を返す */
  onAnswer: (answer: Omit<Answer, 'type'>) => boolean;
}

/**
 * 回答者の出題と回答の画面（F8・F10・F17）。段階で出し分ける。
 * - question: 問題文だけ。選択肢は受付開始まで届かない（P2）
 * - accepting: 選択肢を押せる。押したら確定し、締切を待つ
 * - revealed からあと: 押せない。締切の集計（myResult）が届いたら、PlayerPage が ResultView に切り替える
 * 問題が変わったら作り直すよう、呼び出し側で questionId を key にする
 */
export function QuestionView({ question, phase, questionCount, name, onAnswer }: QuestionViewProps) {
  if (phase === 'accepting' && question.choices !== null) {
    // 受付中だけ作る。やり直し（retryQuestion）で受付の前に戻ると捨てられ、二度押しの印と計測の起点も消える
    return (
      <Answering question={question} choices={question.choices} questionCount={questionCount} onAnswer={onAnswer} />
    );
  }
  if (phase === 'question' || phase === 'accepting') {
    return (
      <QuestionFrame
        questionIndex={question.questionIndex}
        questionCount={questionCount}
        text={question.text}
        aside={
          <p className="name-clip min-w-0 rounded-full bg-secondary px-3 py-1 text-note" title={name}>
            {name}
          </p>
        }
      >
        <div className="mt-8 flex flex-1 flex-col gap-3" aria-hidden="true">
          {[0, 1, 2, 3].map((slot) => (
            <div key={slot} className="flex-1 rounded-panel border-2 border-dashed border-border" />
          ))}
        </div>
        <p className="mt-4 text-center font-bold text-muted-foreground">選択肢は、ホストが受付を始めると出ます</p>
      </QuestionFrame>
    );
  }
  return (
    <QuestionFrame questionIndex={question.questionIndex} questionCount={questionCount} text={question.text}>
      {question.choices !== null && (
        <AnswerButtons choices={question.choices} chosen={question.answer?.choiceIndex ?? null} />
      )}
      <AnswerFooter answer={question.answer} limitMs={question.limitMs} closed />
    </QuestionFrame>
  );
}

interface AnsweringProps {
  question: CurrentQuestion;
  choices: string[];
  questionCount: number;
  onAnswer: QuestionViewProps['onAnswer'];
}

/** 受付中。残りを数え、押下は useAnswerPress に任せる（P2・F10） */
function Answering({ question, choices, questionCount, onAnswer }: AnsweringProps) {
  const { questionId, limitMs } = question;
  // 選択肢を描く直前のフレームを起点に数える。回答時間も同じ起点から測る（P2）
  const { startedAt, leftMs, bar } = useCountdown(limitMs, question.remainingMs ?? limitMs);
  const { press, pending } = useAnswerPress({ questionId, limitMs, startedAt, onAnswer });

  const remainingSeconds = Math.ceil(leftMs / 1000);
  const answer = question.answer ?? pending;
  // 部屋の DO の締切（myResult）は alarm の遅れで最大1分遅れるので、端末の数えでも閉じる
  const closed = leftMs === 0;
  // 読み上げは受付中のここだけで渡す。締切のあとの画面は作り直されるので、そこでも渡すと「締切になりました」が2回読まれる
  useAnnouncement(answerAnnouncementOf(answer, choices, limitMs, closed));

  return (
    <QuestionFrame
      questionIndex={question.questionIndex}
      questionCount={questionCount}
      text={question.text}
      aside={
        <p className="shrink-0 font-bold">
          残り <span className="text-lead tabular-nums">{remainingSeconds}</span> 秒
        </p>
      }
      progress={bar}
    >
      <AnswerButtons
        choices={choices}
        chosen={answer?.choiceIndex ?? null}
        onChoose={answer === null && !closed ? press : undefined}
        // 押したボタンが消えるので、一覧へフォーカスを移す。つなぎ直して届いた回答（question.answer）では動かさない
        focusList={pending !== null}
      />
      {(answer !== null || closed) && <AnswerFooter answer={answer} limitMs={limitMs} closed={closed} />}
    </QuestionFrame>
  );
}
