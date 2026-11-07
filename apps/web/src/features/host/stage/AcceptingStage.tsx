import type { Ref } from 'react';

import type { CurrentQuestion } from '@/realtime/room-store';
import type { TimeBarValue } from '@/shared/countdown/time-bar';
import { TimeBar } from '@/shared/countdown/TimeBar';
import { useCountdown } from '@/shared/countdown/use-countdown';
import { ChoiceNumber, choiceColors } from '@/shared/results/choice-style';

import { StageFrame, StageHeading } from './StageFrame';

interface AcceptingStageProps {
  question: CurrentQuestion;
  choices: string[];
  questionCount: number;
  /** 回答した人数がまだ届いていないときの分母 */
  participantCount: number;
  /** 進行画面が、ホストの操作のあとにフォーカスを移す見出し */
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * 受付中（F9）。残り時間を数え、描くのは AcceptingStageView に任せる。
 * 受付中だけ作るので、やり直しで出題に戻ると捨てられ、次の受付で数え直す
 */
export function AcceptingStage(props: AcceptingStageProps) {
  const { question } = props;
  const { leftMs, bar } = useCountdown(question.limitMs, question.remainingMs ?? question.limitMs);
  return <AcceptingStageView {...props} leftMs={leftMs} bar={bar} />;
}

export interface AcceptingStageViewProps extends AcceptingStageProps {
  /** 締切までの残り（useCountdown の leftMs） */
  leftMs: number;
  /** 残り時間の棒（useCountdown の bar） */
  bar: TimeBarValue;
}

/** 受付中の表示。残り時間・回答した人数・選択肢を、渡された値のまま描く */
export function AcceptingStageView({
  question,
  choices,
  questionCount,
  participantCount,
  headingRef,
  leftMs,
  bar,
}: AcceptingStageViewProps) {
  const { progress } = question;

  return (
    <StageFrame
      question={question}
      questionCount={questionCount}
      aside={
        <p className="text-stage-label">
          <span>回答</span>{' '}
          <span className="font-numeral text-stage-title tabular-nums">{progress?.answeredCount ?? 0}</span>
          <span className="text-muted-foreground">/ {progress?.participantCount ?? participantCount} 人</span>
        </p>
      }
    >
      <div className="flex items-start gap-stage">
        <StageHeading ref={headingRef} className="min-w-0 flex-1 text-question">
          {question.text}
        </StageHeading>
        <p className="shrink-0 text-center">
          <span className="sr-only">残り</span>
          <span className="block font-numeral text-timer tabular-nums">{Math.ceil(leftMs / 1000)}</span>
          <span className="text-stage-label text-muted-foreground">秒</span>
        </p>
      </div>
      <TimeBar {...bar} variant="projector" />
      <ol aria-label="選択肢" className="grid flex-1 grid-cols-1 gap-4 text-choice font-bold md:grid-cols-2">
        {choices.map((choice, index) => (
          <li
            // 選択肢は受付中に変わらないので、番号を key にしてよい
            key={index}
            className={`flex min-w-0 items-center gap-[0.6em] rounded-panel px-[0.7em] py-[0.5em] shadow-panel ${choiceColors[index].panel}`}
          >
            <ChoiceNumber index={index} className={choiceColors[index].badge} />
            <span className="min-w-0 wrap-anywhere text-phrase">{choice}</span>
          </li>
        ))}
      </ol>
    </StageFrame>
  );
}
