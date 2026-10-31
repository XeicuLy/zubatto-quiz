import type { Revealed } from '@zubatto-quiz/protocol';

import { ChoiceNumber, choiceColors } from './choice-style';

export interface AnswerDistributionProps {
  revealed: Revealed;
  /** 受付開始で届いた選択肢。届いていなければ番号だけを出す */
  choices: string[] | null;
}

/**
 * ① 回答の分布（F13）。正解だけ色を残し、ほかは沈める。人数は棒の長さと数字の両方で出す。
 * 投影する進行画面でだけ使うので、文字は vw で伸びるトークン（text-choice）で書く。
 * 人数は部屋の DO が締切のあとに数えたものなので、ここでは数え直さない
 */
export function AnswerDistribution({ revealed, choices }: AnswerDistributionProps) {
  return (
    <ol aria-label="回答の分布" className="grid flex-1 grid-cols-1 content-start gap-3 text-choice font-bold">
      {revealed.choiceCounts.map((count, index) => {
        const isCorrect = index === revealed.correctIndex;
        const colors = choiceColors[index];
        return (
          <li
            // 選択肢の並びは締切のあとに変わらないので、番号を key にしてよい
            key={index}
            className={`relative min-w-0 overflow-hidden rounded-panel ${
              isCorrect
                ? `${colors.panel} ring-4 ring-on-stage ring-offset-4 ring-offset-stage`
                : 'bg-stage-raised text-on-stage-muted'
            }`}
          >
            {/* 幅は人数で変わるので、クラスではなく style で渡す。React は CSSOM で書くので、CSP の style-src に触れない */}
            <div
              className={`absolute inset-y-0 left-0 ${isCorrect ? 'bg-stage/20' : colors.bar}`}
              style={{ width: `${barRatioOf(count, revealed.answeredCount) * 100}%` }}
              aria-hidden="true"
            />
            <div className="relative flex items-center gap-[0.6em] px-[0.7em] py-[0.4em]">
              <ChoiceNumber index={index} className={isCorrect ? colors.badge : colors.badgeMuted} />
              <span className="min-w-0 flex-1 wrap-anywhere">{choices?.[index] ?? ''}</span>
              {isCorrect && <span className="shrink-0 text-[0.7em]">○ 正解</span>}
              <span className="shrink-0 font-numeral tabular-nums">
                {count}
                <span className="ml-1 text-[0.6em]">人</span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 棒の長さ（0〜1）。回答した人のうち、その選択肢を選んだ人の割合にする。
 * どの選択肢の棒を足しても、ちょうど1本ぶん（100%）になる
 */
function barRatioOf(count: number, answeredCount: number): number {
  // だれも答えていないときに割ると NaN になり、"NaN%" はブラウザに捨てられて棒が消える
  return answeredCount === 0 ? 0 : count / answeredCount;
}
