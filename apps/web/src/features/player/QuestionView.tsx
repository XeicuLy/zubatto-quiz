import type { Answer, RoomPhase } from '@zubatto-quiz/protocol';
import { formatSeconds, normalizeElapsedMs } from '@zubatto-quiz/scoring';
import { useRef, useState, type ReactNode } from 'react';

import { useAnnouncement } from '../../components/a11y/announce';
import type { CurrentQuestion } from '../../realtime/room-store';
import { elapsedMsAt, remainingMsAt } from './answer-timer';
import { AnswerButtons } from './AnswerButtons';
import { useCountdown } from './use-countdown';

type MyAnswer = NonNullable<CurrentQuestion['answer']>;

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
        question={question}
        questionCount={questionCount}
        aside={
          <p className="name-clip min-w-0 rounded-full bg-stage-raised px-3 py-1 text-sm" title={name}>
            {name}
          </p>
        }
      >
        <div className="mt-8 flex flex-1 flex-col gap-3" aria-hidden="true">
          {[0, 1, 2, 3].map((slot) => (
            <div key={slot} className="flex-1 rounded-panel border-2 border-dashed border-stage-line" />
          ))}
        </div>
        <p className="mt-4 text-center font-bold text-on-stage-muted">選択肢は、ホストが受付を始めると出ます</p>
      </QuestionFrame>
    );
  }
  return (
    <QuestionFrame question={question} questionCount={questionCount}>
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

/** 受付中。表示の瞬間を起点に時間を測り、1回だけ送る（P2・F10） */
function Answering({ question, choices, questionCount, onAnswer }: AnsweringProps) {
  const { questionId, limitMs } = question;
  // 選択肢を描く直前のフレームを起点に数える。回答時間も同じ起点から測る（P2）
  const { startedAt, leftMs, nextTickMs } = useCountdown(limitMs, question.remainingMs ?? limitMs);
  /** 押した瞬間に出す回答。answerAccepted が届いたら、そちらを使う */
  const [pending, setPending] = useState<MyAnswer | null>(null);
  /** 二度押しの印。state は次の描画まで変わらないので、同じフレームの2回目の押下を止めるには ref が要る */
  const sent = useRef(false);

  const remainingSeconds = Math.ceil(leftMs / 1000);
  const answer = question.answer ?? pending;
  // 部屋の DO の締切（myResult）は alarm の遅れで最大1分遅れるので、端末の数えでも閉じる
  const closed = leftMs === 0;
  // 読み上げは受付中のここだけで渡す。締切のあとの画面は作り直されるので、そこでも渡すと「締切になりました」が2回読まれる
  useAnnouncement(answerAnnouncementOf(answer, limitMs, closed));

  function choose(choiceIndex: number) {
    if (sent.current || startedAt === null) {
      return;
    }
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

  return (
    <QuestionFrame
      question={question}
      questionCount={questionCount}
      aside={
        <p className="shrink-0 font-bold">
          残り <span className="font-display text-2xl tabular-nums">{remainingSeconds}</span> 秒
        </p>
      }
      // 次に描き直すときの残りへ、それまでの時間をかけて縮める。棒は秒の変わり目を待たずに、なめらかに減る
      progress={
        startedAt === null
          ? { ratio: leftMs / limitMs }
          : { ratio: (leftMs - nextTickMs) / limitMs, overMs: nextTickMs }
      }
    >
      <AnswerButtons
        choices={choices}
        chosen={answer?.choiceIndex ?? null}
        onChoose={answer === null && !closed ? choose : undefined}
      />
      {(answer !== null || closed) && <AnswerFooter answer={answer} limitMs={limitMs} closed={closed} />}
    </QuestionFrame>
  );
}

interface QuestionFrameProps {
  question: CurrentQuestion;
  questionCount: number;
  /** ヘッダーの右に出すもの */
  aside?: ReactNode;
  /** 残り時間の棒。受付中だけ渡す。ratio（0〜1）へ overMs ミリ秒かけて縮める */
  progress?: { ratio: number; overMs?: number };
  children: ReactNode;
}

/** 問題の番号・問題文と、その下の中身。問題文は文字のまま出し、ホストの入れた改行だけを whitespace-pre-line で残す（F5） */
function QuestionFrame({ question, questionCount, aside, progress, children }: QuestionFrameProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-4 pb-24">
      <header className="flex items-center justify-between gap-4 border-b border-stage-line pb-3">
        <p className="shrink-0 font-display text-lg">
          第{question.questionIndex + 1}問 <span className="text-sm text-on-stage-muted">/ {questionCount}</span>
        </p>
        {aside}
      </header>
      {progress !== undefined && (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-stage-raised" aria-hidden="true">
          {/* 幅は描くたびに変わるので、クラスではなく style で渡す。React は CSSOM で書くので、CSP の style-src に触れない */}
          <div
            className="h-full rounded-full bg-on-stage transition-[width] ease-linear"
            style={{ width: `${Math.max(0, progress.ratio) * 100}%`, transitionDuration: `${progress.overMs ?? 0}ms` }}
          />
        </div>
      )}
      <h1 className="mt-5 text-2xl leading-relaxed font-bold text-phrase whitespace-pre-line">{question.text}</h1>
      {children}
    </main>
  );
}

/**
 * 回答済みと締切の知らせ。時間はサーバーと同じく0.01秒単位に切り捨てて出す。
 * 押したときに箱ごと現れるので role="status" は付けず、読み上げは Answering が answerAnnouncementOf の文を渡す
 */
function AnswerFooter({ answer, limitMs, closed }: { answer: MyAnswer | null; limitMs: number; closed: boolean }) {
  return (
    <div className="mt-auto pt-8 text-center">
      {answer !== null && (
        <>
          <p className="text-on-stage-muted">回答までの時間</p>
          <p className="font-display text-6xl tabular-nums">
            {secondsOf(answer, limitMs)}
            <span className="ml-1 text-2xl">秒</span>
          </p>
        </>
      )}
      <p className="mt-4 font-bold text-on-stage-muted">{closed ? '締切になりました' : '締切を待っています'}</p>
    </div>
  );
}

/** AnswerFooter と同じことを読み上げる文。締切になったら、時間はもう読んだので締切だけを言う */
function answerAnnouncementOf(answer: MyAnswer | null, limitMs: number, closed: boolean): string | null {
  if (closed) {
    return '締切になりました';
  }
  return answer === null ? null : `回答までの時間 ${secondsOf(answer, limitMs)}秒。締切を待っています`;
}

function secondsOf(answer: MyAnswer, limitMs: number): string {
  return formatSeconds(normalizeElapsedMs(answer.elapsedMs, limitMs));
}
