import type { MyResult } from '@zubatto-quiz/protocol';
import { formatSeconds } from '@zubatto-quiz/scoring';

import { choiceLabel, formatPoints } from './format';

export interface QuestionResultProps {
  result: MyResult;
  /** 受付開始で届いた選択肢。届いていなければ番号だけを出す */
  choices: string[] | null;
}

/**
 * ① 回答者の結果（F15）。正誤・正解の選択肢・この問題の得点を出す。回答者画面でだけ使う。
 * 秒数はサーバーが0.01秒単位に切り捨てた値なので、そのまま出す（P2）。
 * 早押しボーナス（F12）は、もらえたときだけ早押しパネルの黄色の印で出す。点は設定値を持たず、DO から届いた bonusPoints を出す
 */
export function QuestionResult({ result, choices }: QuestionResultProps) {
  const correctChoice = choiceLabel(result.correctIndex, choices);
  return (
    <section className="mt-8 text-center" aria-label="この問題の結果">
      {result.answer === null ? (
        <>
          <h2 className="font-display text-6xl text-on-stage-muted">時間切れ</h2>
          <p className="mt-4 text-lg">正解は {correctChoice}</p>
        </>
      ) : result.correct ? (
        <>
          <h2 className="font-display text-7xl text-correct">○ 正解</h2>
          <p className="mt-3 text-lg wrap-anywhere">{correctChoice}</p>
        </>
      ) : (
        <>
          <h2 className="font-display text-7xl text-on-stage-muted">× 不正解</h2>
          <p className="mt-3 text-lg wrap-anywhere">正解は {correctChoice}</p>
          <p className="mt-1 wrap-anywhere text-on-stage-muted">
            あなたの回答: {choiceLabel(result.answer.choiceIndex, choices)}
          </p>
        </>
      )}
      <p className="mt-4 font-display text-5xl tabular-nums">
        +{formatPoints(result.points)}
        <span className="ml-1 text-xl">点</span>
      </p>
      {result.bonusPoints > 0 && (
        <p className="mt-2 inline-block rounded-full bg-choice-4 px-4 py-1 font-bold text-on-choice-4">
          <span>早押しボーナス</span>{' '}
          <span className="font-display tabular-nums">+{formatPoints(result.bonusPoints)}点</span>
        </p>
      )}
      {result.correct && result.answer !== null && (
        <p className="mt-1 text-on-stage-muted">{formatSeconds(result.answer.elapsedMs)}秒で正解</p>
      )}
    </section>
  );
}
