import type { FinalRanking as FinalRankingMessage, Revealed, RoomSnapshot } from '@zubatto-quiz/protocol';
import type { ReactNode } from 'react';

import type { CurrentQuestion } from '../../realtime/room-store';
import { useCountdown } from '../player/use-countdown';
import { FastestCorrect } from '../results/FastestCorrect';
import { FinalRanking, StandingsRanking } from '../results/Ranking';

export interface HostStageProps {
  /** 待機（lobby）は HostLobby が出すので渡さない */
  room: RoomSnapshot;
  question: CurrentQuestion | null;
  finalRanking: FinalRankingMessage | null;
  /** 回答した人数がまだ届いていないときの分母 */
  participantCount: number;
}

/**
 * 進行画面の、投影する部分（F9・F13・F14・F15・F16）。1問の流れ（docs/design/README.md）の段階で出し分ける。
 * 文字と余白は vw で伸びるトークン（text-question・p-stage など）を使うので、PC からの投影でもホストのスマホでも読める。
 * ② ③ と最終ランキングは、回答者画面と共有する部品（features/results）の projector 版を使う。
 * つなぎ直したときは、部屋の DO が今の問題の流れを最初から送り直すので、届いたものを描くだけでよい
 */
export function HostStage({ room, question, finalRanking, participantCount }: HostStageProps) {
  if (room.phase === 'final') {
    return finalRanking === null ? (
      <StatusScreen>最終の結果を集計しています</StatusScreen>
    ) : (
      <main className="flex flex-1 flex-col">
        <FinalRanking ranking={finalRanking} variant="projector" />
      </main>
    );
  }
  if (question === null) {
    return <StatusScreen>部屋の様子を読み込んでいます</StatusScreen>;
  }
  switch (room.phase) {
    case 'question':
      return <QuestionStage question={question} questionCount={room.questionCount} />;
    case 'accepting':
      return question.choices === null ? (
        <QuestionStage question={question} questionCount={room.questionCount} />
      ) : (
        <AcceptingStage
          question={question}
          choices={question.choices}
          questionCount={room.questionCount}
          participantCount={participantCount}
        />
      );
    case 'revealed':
      return question.revealed === null ? (
        <StatusScreen>結果を集計しています</StatusScreen>
      ) : (
        <RevealedStage question={question} revealed={question.revealed} questionCount={room.questionCount} />
      );
    case 'fastest':
      return question.fastest === null ? (
        <StatusScreen>結果を集計しています</StatusScreen>
      ) : (
        <main className="flex flex-1 flex-col">
          <FastestCorrect
            fastest={question.fastest}
            questionIndex={question.questionIndex}
            choices={question.choices}
            variant="projector"
          />
        </main>
      );
    case 'standings':
      return question.standings === null ? (
        <StatusScreen>結果を集計しています</StatusScreen>
      ) : (
        <main className="flex flex-1 flex-col">
          <StandingsRanking standings={question.standings} variant="projector" />
        </main>
      );
    case 'lobby':
      return null;
  }
}

/** 出題。読み上げのあいだは問題文だけを大きく出す（F8） */
function QuestionStage({ question, questionCount }: { question: CurrentQuestion; questionCount: number }) {
  return (
    <StageFrame
      question={question}
      questionCount={questionCount}
      aside={<p className="text-stage-label text-on-stage-muted">制限時間 {question.limitMs / 1000}秒</p>}
    >
      <h1 className="my-auto max-w-[24em] text-question font-bold text-phrase">{question.text}</h1>
    </StageFrame>
  );
}

interface AcceptingStageProps {
  question: CurrentQuestion;
  choices: string[];
  questionCount: number;
  participantCount: number;
}

/**
 * 受付中。残り時間・回答した人数・選択肢を出す（F9）。
 * 受付中だけ作るので、やり直しで出題に戻ると捨てられ、次の受付で数え直す
 */
function AcceptingStage({ question, choices, questionCount, participantCount }: AcceptingStageProps) {
  const { startedAt, leftMs, nextTickMs } = useCountdown(question.limitMs, question.remainingMs ?? question.limitMs);
  const { progress } = question;
  // 次に描き直すときの残りへ、それまでの時間をかけて縮める。回答者の画面と同じ動き
  const ratio = startedAt === null ? leftMs / question.limitMs : (leftMs - nextTickMs) / question.limitMs;

  return (
    <StageFrame
      question={question}
      questionCount={questionCount}
      aside={
        <p className="text-stage-label">
          <span>回答</span>{' '}
          <span className="font-display text-stage-title tabular-nums">{progress?.answeredCount ?? 0}</span>
          <span className="text-on-stage-muted">/ {progress?.participantCount ?? participantCount} 人</span>
        </p>
      }
    >
      <div className="flex items-start gap-stage">
        <h1 className="min-w-0 flex-1 text-question font-bold text-phrase">{question.text}</h1>
        <p className="shrink-0 text-center">
          <span className="sr-only">残り</span>
          <span className="block font-display text-timer tabular-nums">{Math.ceil(leftMs / 1000)}</span>
          <span className="text-stage-label text-on-stage-muted">秒</span>
        </p>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-stage-raised" aria-hidden="true">
        {/* 幅は描くたびに変わるので、クラスではなく style で渡す。React は CSSOM で書くので、CSP の style-src に触れない */}
        <div
          className="h-full rounded-full bg-on-stage transition-[width] ease-linear"
          style={{
            width: `${Math.max(0, ratio) * 100}%`,
            transitionDuration: `${startedAt === null ? 0 : nextTickMs}ms`,
          }}
        />
      </div>
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

interface RevealedStageProps {
  question: CurrentQuestion;
  revealed: Revealed;
  questionCount: number;
}

/** ① 正解と回答の分布（F13）。正解だけ色を残し、ほかは沈める。人数は棒の長さと数字の両方で出す */
function RevealedStage({ question, revealed, questionCount }: RevealedStageProps) {
  return (
    <StageFrame
      question={question}
      questionCount={questionCount}
      aside={
        <p className="text-stage-label text-on-stage-muted">
          締め切りました（{revealed.participantCount}人中 {revealed.answeredCount}人が回答）
        </p>
      }
    >
      <h1 className="text-stage-title font-bold text-phrase">{question.text}</h1>
      <ol aria-label="回答の分布" className="grid flex-1 grid-cols-1 content-start gap-3 text-choice font-bold">
        {revealed.choiceCounts.map((count, index) => {
          const isCorrect = index === revealed.correctIndex;
          const colors = choiceColors[index];
          // 選んだ人の割合。だれも答えていなければ棒を出さない
          const width = `${(count / Math.max(1, revealed.answeredCount)) * 100}%`;
          return (
            <li
              key={index}
              className={`relative min-w-0 overflow-hidden rounded-panel ${
                isCorrect
                  ? `${colors.panel} ring-4 ring-on-stage ring-offset-4 ring-offset-stage`
                  : 'bg-stage-raised text-on-stage-muted'
              }`}
            >
              <div
                className={`absolute inset-y-0 left-0 ${isCorrect ? 'bg-stage/20' : colors.bar}`}
                style={{ width }}
                aria-hidden="true"
              />
              <div className="relative flex items-center gap-[0.6em] px-[0.7em] py-[0.4em]">
                <ChoiceNumber index={index} className={isCorrect ? colors.badge : colors.badgeMuted} />
                <span className="min-w-0 flex-1 wrap-anywhere">{question.choices?.[index] ?? ''}</span>
                {isCorrect && <span className="shrink-0 text-[0.7em]">○ 正解</span>}
                <span className="shrink-0 font-display tabular-nums">
                  {count}
                  <span className="ml-1 text-[0.6em]">人</span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </StageFrame>
  );
}

/**
 * 選択肢の色。色だけに頼らず、必ず番号と一緒に出す。
 * Tailwind はクラス名を文字列のまま探すので、色のクラスは組み立てずに選択肢ごとに書いておく
 */
const choiceColors = [
  {
    panel: 'bg-choice-1 text-on-choice',
    badge: 'bg-stage/25',
    badgeMuted: 'bg-choice-1 text-on-choice',
    bar: 'bg-choice-1/35',
  },
  {
    panel: 'bg-choice-2 text-on-choice',
    badge: 'bg-stage/25',
    badgeMuted: 'bg-choice-2 text-on-choice',
    bar: 'bg-choice-2/35',
  },
  {
    panel: 'bg-choice-3 text-on-choice',
    badge: 'bg-stage/25',
    badgeMuted: 'bg-choice-3 text-on-choice',
    bar: 'bg-choice-3/35',
  },
  // 黄色の上は白い字が読めないので、濃い字にする
  {
    panel: 'bg-choice-4 text-on-choice-4',
    badge: 'bg-stage/15',
    badgeMuted: 'bg-choice-4 text-on-choice-4',
    bar: 'bg-choice-4/35',
  },
] as const;

function ChoiceNumber({ index, className }: { index: number; className: string }) {
  return (
    <span className={`grid size-[1.6em] shrink-0 place-items-center rounded-full font-display ${className}`}>
      {index + 1}
    </span>
  );
}

interface StageFrameProps {
  question: CurrentQuestion;
  questionCount: number;
  /** ヘッダーの右に出すもの */
  aside: ReactNode;
  children: ReactNode;
}

/** 問題の番号と、その下の中身。出題・受付中・① で共通 */
function StageFrame({ question, questionCount, aside, children }: StageFrameProps) {
  return (
    <main className="flex flex-1 flex-col gap-stage p-stage">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="font-display text-stage-title">
          <span>第{question.questionIndex + 1}問</span>{' '}
          <span className="text-stage-label text-on-stage-muted">/ {questionCount}</span>
        </p>
        {aside}
      </header>
      {children}
    </main>
  );
}

function StatusScreen({ children }: { children: string }) {
  return (
    <main className="flex flex-1 flex-col justify-center p-stage">
      <p role="status" className="text-stage-title font-bold">
        {children}
      </p>
    </main>
  );
}
