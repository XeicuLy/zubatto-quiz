import type { FinalRanking as FinalRankingMessage, RoomSnapshot } from '@zubatto-quiz/protocol';
import type { Ref } from 'react';

import type { CurrentQuestion } from '@/realtime/room-store';
import { FastestCorrect } from '@/shared/results/FastestCorrect';
import { FinalRanking } from '@/shared/results/FinalRanking';
import { StandingsRanking } from '@/shared/results/StandingsRanking';
import { StatusScreen } from '@/shared/status/StatusScreen';

import { AcceptingStage } from './stage/AcceptingStage';
import { QuestionStage } from './stage/QuestionStage';
import { RevealedStage } from './stage/RevealedStage';

export interface HostStageProps {
  /** 待機（lobby）は HostLobby が出すので渡さない */
  room: RoomSnapshot;
  question: CurrentQuestion | null;
  finalRanking: FinalRankingMessage | null;
  /** 回答した人数がまだ届いていないときの分母 */
  participantCount: number;
  /** 今の段階の見出し。ホストが操作したあと、進行画面がここへフォーカスを移す */
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * 進行画面の、投影する部分（F9・F13・F14・F15・F16）。1問の流れ（docs/design/README.md）の段階で出し分けるだけにする。
 * 出題・受付中・① は stage/ の部品が、② ③・最終ランキングは shared/results の projector 版（回答者画面と共有）が描く。
 * 文字と余白は vw で伸びるトークン（text-question・p-stage など）を使うので、PC からの投影でもホストのスマホでも読める。
 * つなぎ直したときは、部屋の DO が今の問題の流れを最初から送り直すので、届いたものを描くだけでよい。
 * どの段階でも見出しに headingRef を渡す。見出しは tabIndex={-1} で、Tab の順番には入らずにフォーカスだけ受ける
 */
export function HostStage({ room, question, finalRanking, participantCount, headingRef }: HostStageProps) {
  if (room.phase === 'final') {
    return finalRanking === null ? (
      <StatusScreen variant="projector">最終の結果を集計しています</StatusScreen>
    ) : (
      <main className="flex flex-1 flex-col">
        <FinalRanking ranking={finalRanking} variant="projector" headingRef={headingRef} />
      </main>
    );
  }
  if (question === null) {
    return <StatusScreen variant="projector">部屋の様子を読み込んでいます</StatusScreen>;
  }
  switch (room.phase) {
    case 'question':
      return <QuestionStage question={question} questionCount={room.questionCount} headingRef={headingRef} />;
    case 'accepting':
      return question.choices === null ? (
        <QuestionStage question={question} questionCount={room.questionCount} headingRef={headingRef} />
      ) : (
        <AcceptingStage
          question={question}
          choices={question.choices}
          questionCount={room.questionCount}
          participantCount={participantCount}
          headingRef={headingRef}
        />
      );
    case 'revealed':
      return question.revealed === null ? (
        <StatusScreen variant="projector">結果を集計しています</StatusScreen>
      ) : (
        <RevealedStage
          question={question}
          revealed={question.revealed}
          questionCount={room.questionCount}
          headingRef={headingRef}
        />
      );
    case 'fastest':
      return question.fastest === null ? (
        <StatusScreen variant="projector">結果を集計しています</StatusScreen>
      ) : (
        <main className="flex flex-1 flex-col">
          <FastestCorrect
            fastest={question.fastest}
            questionIndex={question.questionIndex}
            choices={question.choices}
            variant="projector"
            headingRef={headingRef}
          />
        </main>
      );
    case 'standings':
      return question.standings === null ? (
        <StatusScreen variant="projector">結果を集計しています</StatusScreen>
      ) : (
        <main className="flex flex-1 flex-col">
          <StandingsRanking standings={question.standings} variant="projector" headingRef={headingRef} />
        </main>
      );
    case 'lobby':
      return null;
  }
}
