import type { FastestRevealed } from '@zubatto-quiz/protocol';
import { formatSeconds } from '@zubatto-quiz/scoring';
import type { Ref } from 'react';

import { choiceLabel } from './format';
import type { Variant } from './variant';

export interface FastestCorrectProps {
  fastest: FastestRevealed;
  /** 0から数えた問題の番号 */
  questionIndex: number;
  /** 受付開始で届いた選択肢。投影の見出しで正解を出すのに使う */
  choices: string[] | null;
  variant: Variant;
  /** 投影の見出し。進行画面がホストの操作のあとにフォーカスを移す。渡したときだけ tabIndex={-1} にする */
  headingRef?: Ref<HTMLHeadingElement>;
}

type FastAnswer = FastestRevealed['fastest'][number];

/**
 * ② 最速正解の発表（F14）。最速の3人と秒数・正解した人数・この問題で一番順位を上げた人を出す。
 * 並びと秒数はサーバーが決めたまま出す（同じ秒数は入室した順。秒数は0.01秒単位に切り捨て済み）。
 * 投影では画面いっぱいの見せ場にし、回答者画面では ① の結果の下に小さく出す
 */
export function FastestCorrect({ fastest, questionIndex, choices, variant, headingRef }: FastestCorrectProps) {
  return variant === 'projector' ? (
    <FastestStage fastest={fastest} questionIndex={questionIndex} choices={choices} headingRef={headingRef} />
  ) : (
    <FastestCard fastest={fastest} />
  );
}

/** 順位を上げた人。第1問・誰も上げなかったとき・最後の2問は null */
function climberOf(fastest: FastestRevealed) {
  return fastest.ranksHidden ? null : fastest.biggestClimber;
}

function countsOf(fastest: FastestRevealed): string {
  return `${fastest.answeredCount}人中 ${fastest.correctCount}人が正解`;
}

/** 投影。spotlight の色は、正解者がいるときの見せ場にだけ使う */
function FastestStage({ fastest, questionIndex, choices, headingRef }: Omit<FastestCorrectProps, 'variant'>) {
  const [first, ...rest] = fastest.fastest;
  const climber = climberOf(fastest);
  const header = (
    <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <h2 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-stage-title font-bold focus-target">
        第{questionIndex + 1}問の最速正解
      </h2>
      <p className={first === undefined ? 'text-stage-label text-on-stage-muted' : 'text-stage-label'}>
        正解は {choiceLabel(fastest.correctIndex, choices)}（{countsOf(fastest)}）
      </p>
    </header>
  );

  if (first === undefined) {
    return (
      <section aria-label="最速正解の発表" className="flex flex-1 flex-col gap-stage p-stage">
        {header}
        <div className="my-auto">
          <p className="text-timer font-bold">正解者なし</p>
          <p className="mt-4 text-stage-title text-on-stage-muted">この問題に正解した人はいませんでした</p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="最速正解の発表"
      className="flex flex-1 flex-col gap-stage bg-spotlight p-stage text-on-spotlight"
    >
      {header}
      <ol
        aria-label="最速の3人"
        className="grid flex-1 grid-cols-1 grid-rows-[1fr] gap-x-stage gap-y-3 text-stage-label md:grid-cols-2"
      >
        <li className="self-center motion-safe:animate-spotlight-in md:col-span-2">
          {/* 見せ場なので省略せず、折り返して全部見せる。長い名前は1段小さくして、3行以上に割れないようにする */}
          <p className={`name-wrap font-bold ${[...first.name].length > 12 ? 'text-question' : 'text-timer'}`}>
            {first.name}
          </p>
          <p className="mt-[0.1em] font-numeral text-hero tabular-nums">
            {formatSeconds(first.elapsedMs)}
            <span className="ml-[0.15em] text-[0.35em]">秒</span>
          </p>
        </li>
        {rest.map((answer, index) => (
          <li key={answer.participantId} className="min-w-0 border-t-2 border-on-spotlight/25 pt-4">
            <p className="font-bold">{index + 2}番目に速い正解</p>
            <FastAnswerRow answer={answer} nameClassName="text-stage-title font-bold" numeralClassName="font-numeral" />
          </li>
        ))}
      </ol>
      {fastest.ranksHidden ? (
        <p className="border-t-2 border-on-spotlight/25 pt-4 text-stage-label font-bold">
          ここからの順位は、最終発表まで伏せています
        </p>
      ) : (
        climber !== null && (
          <div className="border-t-2 border-on-spotlight/25 pt-4 text-stage-label">
            <p className="font-bold">この問題で一番順位を上げた人</p>
            <ClimberRow climber={climber} nameClassName="text-stage-title font-bold" numeralClassName="font-numeral" />
          </div>
        )
      )}
    </section>
  );
}

/** 回答者画面。① の結果の下に出す小さな枠 */
function FastestCard({ fastest }: { fastest: FastestRevealed }) {
  const climber = climberOf(fastest);
  // spotlight の色は、正解者がいるときの見せ場にだけ使う
  const none = fastest.fastest.length === 0;
  return (
    <section
      aria-label="最速正解"
      className={`mt-6 rounded-panel border-2 px-4 py-3 ${none ? 'border-stage-line' : 'border-spotlight'}`}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className={`shrink-0 text-sm font-bold ${none ? 'text-on-stage-muted' : 'text-spotlight'}`}>最速正解</h2>
        <p className="text-xs text-on-stage-muted">{countsOf(fastest)}</p>
      </header>
      {none ? (
        <p className="mt-2 font-bold">正解者なし</p>
      ) : (
        <ol aria-label="最速の3人" className="mt-2 grid grid-cols-1 gap-1">
          {fastest.fastest.map((answer, index) => (
            <li key={answer.participantId} className={`flex items-baseline gap-3 ${index === 0 ? 'text-xl' : ''}`}>
              <span className="w-[1.2em] shrink-0 text-sm font-bold text-on-stage-muted">{index + 1}</span>
              <FastAnswerRow answer={answer} nameClassName="font-bold" numeralClassName="font-bold" />
            </li>
          ))}
        </ol>
      )}
      {climber !== null && (
        <div className="mt-3 border-t border-stage-line pt-2 text-sm">
          <p className="text-on-stage-muted">この問題で一番順位を上げた人</p>
          <ClimberRow climber={climber} nameClassName="font-bold" numeralClassName="font-bold" />
        </div>
      )}
    </section>
  );
}

/** 秒数や上げた幅の字体。飾り文字は投影だけで、回答者画面では本文の字体の太字にする */
interface RowFontProps {
  nameClassName: string;
  numeralClassName: string;
}

/** 名前と秒数の1行。名前は1行で省略し、title で全文を見せる */
function FastAnswerRow({ answer, nameClassName, numeralClassName }: { answer: FastAnswer } & RowFontProps) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-3">
      <span className={`name-clip flex-1 ${nameClassName}`} title={answer.name}>
        {answer.name}
      </span>
      <span className={`shrink-0 tabular-nums ${numeralClassName}`}>
        {formatSeconds(answer.elapsedMs)}
        <span className="ml-0.5 text-[0.7em]">秒</span>
      </span>
    </span>
  );
}

/** 順位を上げた人。順位の数字は出さず、上げた幅だけを出す */
function ClimberRow({
  climber,
  nameClassName,
  numeralClassName,
}: { climber: NonNullable<ReturnType<typeof climberOf>> } & RowFontProps) {
  return (
    <p className="flex items-baseline gap-3">
      <span className={`name-clip flex-1 ${nameClassName}`} title={climber.name}>
        {climber.name}
      </span>
      <span className={`shrink-0 tabular-nums ${numeralClassName}`}>
        <span aria-hidden="true">▲</span>
        {climber.rankUp}
        <span className="sr-only">つ上げた</span>
      </span>
    </p>
  );
}
