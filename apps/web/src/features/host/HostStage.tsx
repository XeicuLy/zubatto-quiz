import type { FinalRanking as FinalRankingMessage, Revealed, RoomSnapshot } from '@zubatto-quiz/protocol';
import type { ReactNode, Ref } from 'react';

import { useAnnouncement } from '../../components/a11y/announce';
import type { CurrentQuestion } from '../../realtime/room-store';
import { useCountdown } from '../player/use-countdown';
import { AnswerDistribution } from '../results/AnswerDistribution';
import { ChoiceNumber, choiceColors } from '../results/choice-style';
import { FastestCorrect } from '../results/FastestCorrect';
import { FinalRanking, StandingsRanking } from '../results/Ranking';

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
 * 進行画面の、投影する部分（F9・F13・F14・F15・F16）。1問の流れ（docs/design/README.md）の段階で出し分ける。
 * 文字と余白は vw で伸びるトークン（text-question・p-stage など）を使うので、PC からの投影でもホストのスマホでも読める。
 * 問題文は文字のまま出し、ホストの入れた改行だけを whitespace-pre-line で残す（F5）。
 * ① の回答の分布と ② ③・最終ランキングは、features/results の部品（② ③ と最終ランキングは回答者画面と共有の projector 版）を使う。
 * つなぎ直したときは、部屋の DO が今の問題の流れを最初から送り直すので、届いたものを描くだけでよい。
 * どの段階でも見出しに headingRef を付け、tabIndex={-1} で Tab の順番には入れずにフォーカスだけ受けられるようにする
 */
export function HostStage({ room, question, finalRanking, participantCount, headingRef }: HostStageProps) {
  if (room.phase === 'final') {
    return finalRanking === null ? (
      <StatusScreen>最終の結果を集計しています</StatusScreen>
    ) : (
      <main className="flex flex-1 flex-col">
        <FinalRanking ranking={finalRanking} variant="projector" headingRef={headingRef} />
      </main>
    );
  }
  if (question === null) {
    return <StatusScreen>部屋の様子を読み込んでいます</StatusScreen>;
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
        <StatusScreen>結果を集計しています</StatusScreen>
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
        <StatusScreen>結果を集計しています</StatusScreen>
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
        <StatusScreen>結果を集計しています</StatusScreen>
      ) : (
        <main className="flex flex-1 flex-col">
          <StandingsRanking standings={question.standings} variant="projector" headingRef={headingRef} />
        </main>
      );
    case 'lobby':
      return null;
  }
}

interface QuestionStageProps {
  question: CurrentQuestion;
  questionCount: number;
  headingRef: Ref<HTMLHeadingElement> | undefined;
}

/** 出題。読み上げのあいだは問題文だけを大きく出す（F8） */
function QuestionStage({ question, questionCount, headingRef }: QuestionStageProps) {
  return (
    <StageFrame
      question={question}
      questionCount={questionCount}
      aside={<p className="text-stage-label text-on-stage-muted">制限時間 {question.limitMs / 1000}秒</p>}
    >
      <h1
        ref={headingRef}
        tabIndex={-1}
        className={`my-auto max-w-[24em] text-question font-bold text-phrase whitespace-pre-line ${focusTarget}`}
      >
        {question.text}
      </h1>
    </StageFrame>
  );
}

interface AcceptingStageProps {
  question: CurrentQuestion;
  choices: string[];
  questionCount: number;
  participantCount: number;
  headingRef: Ref<HTMLHeadingElement> | undefined;
}

/**
 * 受付中。残り時間・回答した人数・選択肢を出す（F9）。
 * 受付中だけ作るので、やり直しで出題に戻ると捨てられ、次の受付で数え直す
 */
function AcceptingStage({ question, choices, questionCount, participantCount, headingRef }: AcceptingStageProps) {
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
        <h1
          ref={headingRef}
          tabIndex={-1}
          className={`min-w-0 flex-1 text-question font-bold text-phrase whitespace-pre-line ${focusTarget}`}
        >
          {question.text}
        </h1>
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
  headingRef: Ref<HTMLHeadingElement> | undefined;
}

/** ① 正解と回答の分布（F13）。問題文の下に、選択肢ごとの人数を出す */
function RevealedStage({ question, revealed, questionCount, headingRef }: RevealedStageProps) {
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
      <h1
        ref={headingRef}
        tabIndex={-1}
        className={`text-stage-title font-bold text-phrase whitespace-pre-line ${focusTarget}`}
      >
        {question.text}
      </h1>
      <AnswerDistribution revealed={revealed} choices={question.choices} />
    </StageFrame>
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

/**
 * フォーカスを受けるだけの見出し。押せるものではなく、投影にも映るので、フォーカスの枠は出さない。
 * キーボードで進めるホストには、読み上げと、Tab で操作の帯へ戻れることで伝わる。focus-target は styles.css にある
 */
const focusTarget = 'focus-target';

/** 結果が届くまでのつなぎ。画面ごと現れるので role="status" は付けず、読み上げ領域に文を渡す */
function StatusScreen({ children }: { children: string }) {
  useAnnouncement(children);
  return (
    <main className="flex flex-1 flex-col justify-center p-stage">
      <p className="text-stage-title font-bold">{children}</p>
    </main>
  );
}
