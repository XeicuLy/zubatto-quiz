import type { Ref } from 'react';

import type { CurrentQuestion } from '@/realtime/room-store';

import { StageFrame, StageHeading } from './StageFrame';

interface QuestionStageProps {
  question: CurrentQuestion;
  questionCount: number;
  /** 進行画面が、ホストの操作のあとにフォーカスを移す見出し */
  headingRef?: Ref<HTMLHeadingElement>;
}

/** 出題。読み上げのあいだは問題文だけを大きく出す（F8） */
export function QuestionStage({ question, questionCount, headingRef }: QuestionStageProps) {
  return (
    <StageFrame
      question={question}
      questionCount={questionCount}
      aside={<p className="text-stage-label text-muted-foreground">制限時間 {question.limitMs / 1000}秒</p>}
    >
      <StageHeading ref={headingRef} className="my-auto max-w-[24em] text-question">
        {question.text}
      </StageHeading>
    </StageFrame>
  );
}
