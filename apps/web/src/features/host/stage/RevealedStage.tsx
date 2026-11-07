import type { Revealed } from '@zubatto-quiz/protocol';
import type { Ref } from 'react';

import type { CurrentQuestion } from '@/realtime/room-store';
import { AnswerDistribution } from '@/shared/results/AnswerDistribution';

import { StageFrame, StageHeading } from './StageFrame';

interface RevealedStageProps {
  question: CurrentQuestion;
  revealed: Revealed;
  questionCount: number;
  /** 進行画面が、ホストの操作のあとにフォーカスを移す見出し */
  headingRef?: Ref<HTMLHeadingElement>;
}

/** ① 正解と回答の分布（F13）。問題文の下に、選択肢ごとの人数を出す */
export function RevealedStage({ question, revealed, questionCount, headingRef }: RevealedStageProps) {
  return (
    <StageFrame
      question={question}
      questionCount={questionCount}
      aside={
        <p className="text-stage-label text-muted-foreground">
          締め切りました（{revealed.participantCount}人中 {revealed.answeredCount}人が回答）
        </p>
      }
    >
      <StageHeading ref={headingRef} className="text-stage-title">
        {question.text}
      </StageHeading>
      <AnswerDistribution revealed={revealed} choices={question.choices} />
    </StageFrame>
  );
}
