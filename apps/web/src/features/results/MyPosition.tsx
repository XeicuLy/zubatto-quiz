import type { PlayerPosition } from '@zubatto-quiz/protocol';

import { formatPoints } from './format';

export interface MyPositionProps {
  position: PlayerPosition;
  totalScore: number;
  /** 残りの問題で取れる最大の点。サーバーが myResult で送る */
  remainingMaxPoints: number;
  /** この問題のあとに残っている問題の数 */
  remainingQuestions: number;
}

/** 「2位まで あと 435点」の1行。label のあとに点数を並べて出す */
export interface Goal {
  label: string;
  points: number;
}

/**
 * 次の目標の1行（F15・docs/design/README.md の「順位の見せ方」）。出さないときは null。
 * 4位以下では「8位まで」のように順位の数字を書くと自分の順位が分かるので、「1つ上の人」と書く
 */
export function goalOf(position: PlayerPosition): Goal | null {
  switch (position.kind) {
    case 'leader':
      // ほかに回答者がいなければ、比べる相手がいないので出さない
      return position.leadOverNext === null ? null : { label: '2位との差', points: position.leadOverNext };
    case 'podium':
      return { label: `${position.rank - 1}位まで あと`, points: position.gapToAbove };
    case 'chasing':
      return { label: '1つ上の人まで あと', points: position.gapToAbove };
    case 'hidden':
      // 最後の2問は、順位にかかわることを出さない
      return null;
  }
}

/**
 * 回答者画面の自分の位置（F15）。順位よりも「次の目標」を見せる。回答者画面でだけ使う。
 * - 1〜3位: 順位の数字と、1つ上（1位は2位）との差
 * - 4位以下: 1つ上の人との差・トップとの差・残りで取れる最大の点
 * - 最後の2問: 伏せていることと、残りで取れる最大の点
 * 矢印は順位が上がったときだけ出す。下がったときは何も出さない
 */
export function MyPosition({ position, totalScore, remainingMaxPoints, remainingQuestions }: MyPositionProps) {
  const remaining = remainingQuestions > 0 && (
    <p className="mt-3 text-sm font-bold">
      残り{remainingQuestions}問で、最大 <span className="tabular-nums">{formatPoints(remainingMaxPoints)}</span>
      点 取れます
    </p>
  );

  if (position.kind === 'hidden') {
    return (
      <section
        className="mt-8 rounded-panel border-2 border-dashed border-stage-line p-5 text-center"
        aria-label="あなたの位置"
      >
        <p className="text-lg font-bold">ここからの順位は、最終発表まで伏せています</p>
        {remaining}
      </section>
    );
  }

  const goal = goalOf(position);
  const rank = position.kind === 'leader' ? 1 : position.kind === 'podium' ? position.rank : null;
  const total = (
    <>
      <span className="text-base font-bold text-on-stage tabular-nums">{formatPoints(totalScore)}</span>点
    </>
  );

  return (
    <section className="mt-8 rounded-panel bg-stage-raised p-5" aria-label="あなたの位置">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {rank !== null && (
          <p className="text-4xl font-bold tabular-nums">
            {rank}
            <span className="ml-1 text-lg">位</span>
          </p>
        )}
        {position.rankUp > 0 && (
          <p className="font-bold text-correct">
            <span aria-hidden="true">▲</span>
            {position.rankUp}
            <span className="sr-only">つ</span> 順位が上がりました
          </p>
        )}
      </div>
      {goal !== null && (
        <p className="mt-2 text-lg font-bold">
          {goal.label} <span className="tabular-nums">{formatPoints(goal.points)}</span>点
        </p>
      )}
      {position.kind === 'chasing' ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-stage-line pt-3 text-sm text-on-stage-muted">
            <div>
              <dt>合計</dt>
              <dd>{total}</dd>
            </div>
            <div>
              <dt>トップとの差</dt>
              <dd>
                <span className="text-base font-bold text-on-stage tabular-nums">
                  {formatPoints(position.gapToTop)}
                </span>
                点
              </dd>
            </div>
          </dl>
          {remaining}
        </>
      ) : (
        <p className="mt-3 border-t border-stage-line pt-3 text-sm text-on-stage-muted">合計 {total}</p>
      )}
    </section>
  );
}
