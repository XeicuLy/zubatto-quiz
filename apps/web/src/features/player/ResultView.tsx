import type { MyResult, RoomPhase } from '@zubatto-quiz/protocol';

import { FastestCorrect } from '@/features/results/FastestCorrect';
import { MyPosition } from '@/features/results/MyPosition';
import { QuestionResult } from '@/features/results/QuestionResult';
import { StandingsRanking } from '@/features/results/Ranking';
import type { CurrentQuestion } from '@/realtime/room-store';

export interface ResultViewProps {
  question: CurrentQuestion;
  myResult: MyResult;
  /** 部屋の段階。revealed・fastest・standings のどれか */
  phase: RoomPhase;
  questionCount: number;
  meId: string;
}

/**
 * 回答者の締切のあとの画面（F14・F15）。1問の流れ（docs/design/README.md）の段階で出し分ける。
 * - ① revealed: 正誤と得点・自分の位置
 * - ② fastest: ① の下に最速正解が出る
 * - ③ standings: 上位10人。自分が入っていれば強調する
 */
export function ResultView({ question, myResult, phase, questionCount, meId }: ResultViewProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-4 pb-24">
      <header className="flex items-center justify-between gap-4 border-b border-border pb-3">
        <p className="shrink-0 text-lg font-bold">
          第{question.questionIndex + 1}問 <span className="text-sm text-muted-foreground">/ {questionCount}</span>
        </p>
        <p className="shrink-0 text-muted-foreground">締め切りました</p>
      </header>
      {phase === 'standings' && question.standings !== null ? (
        <StandingsRanking standings={question.standings} variant="mobile" meId={meId} />
      ) : (
        <>
          <QuestionResult result={myResult} choices={question.choices} />
          <MyPosition
            position={myResult.position}
            totalScore={myResult.totalScore}
            remainingMaxPoints={myResult.remainingMaxPoints}
            remainingQuestions={questionCount - question.questionIndex - 1}
          />
          {question.fastest !== null && (
            <FastestCorrect
              fastest={question.fastest}
              questionIndex={question.questionIndex}
              choices={question.choices}
              variant="mobile"
            />
          )}
        </>
      )}
    </main>
  );
}
