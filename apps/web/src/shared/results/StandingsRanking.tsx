import type { Standings } from '@zubatto-quiz/protocol';
import { cva } from 'class-variance-authority';
import type { Ref } from 'react';

import { formatPoints } from './format';
import { MeChip, numeralVariants } from './RankRow';
import type { Variant } from './variant';

// Tailwind はクラス名を文字列のまま探すので、大きさごとのクラスは組み立てずに書いておく。
// oxfmt は cva の引数の class を並べ替える（.oxfmtrc.json の sortTailwindcss.functions）。定数の表に入れると並べ替えないので、cva で書く

const rootVariants = cva('flex flex-col', {
  variants: {
    variant: {
      projector: 'gap-stage p-stage',
      mobile: 'mt-6 gap-3',
    },
  },
});

const titleVariants = cva('font-bold focus-target', {
  variants: {
    variant: {
      projector: 'text-stage-title',
      mobile: 'text-heading',
    },
  },
});

const subVariants = cva('text-muted-foreground', {
  variants: {
    variant: {
      projector: 'text-stage-label',
      mobile: 'text-note',
    },
  },
});

/** 名前は1行で省略し（name-clip）、行の高さをそろえる */
const tableVariants = cva('w-full table-fixed border-separate border-spacing-y-1', {
  variants: {
    variant: {
      projector: 'text-stage-label',
      mobile: 'text-note',
    },
  },
});

export interface StandingsRankingProps {
  standings: Standings;
  variant: Variant;
  /** 回答者画面の自分。上位に入っていれば強調する */
  meId?: string;
  /** 進行画面がホストの操作のあとにフォーカスを移す見出し。渡したときだけ tabIndex={-1} にする */
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * ③ 途中経過（F15）。上位10人を、この問題の点と合計で出す。
 * 順位はサーバーが付けたまま出す。同点は同じ順位（1位・2位・2位・4位）で、同じ順位の人は入室した順に並んで届く（要件定義書の「同点のとき」）。
 * 回答者画面では meId を渡し、自分の行だけを強調する。進行画面では渡さない
 */
export function StandingsRanking({ standings, variant, meId, headingRef }: StandingsRankingProps) {
  const numeral = numeralVariants({ variant });
  return (
    <section aria-label="途中経過" className={rootVariants({ variant })}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className={titleVariants({ variant })}>
          途中経過（第{standings.questionIndex + 1}問まで）
        </h2>
        <p className={subVariants({ variant })}>
          上位{standings.entries.length}人 / {standings.participantCount}人
        </p>
      </header>
      <table aria-label="途中経過" className={tableVariants({ variant })}>
        <colgroup>
          <col className="w-[3.5em]" />
          <col />
          <col className="w-[5em]" />
          <col className="w-[5em]" />
        </colgroup>
        <thead className="whitespace-nowrap text-muted-foreground">
          <tr>
            <th scope="col" className="px-2 text-left font-normal">
              順位
            </th>
            <th scope="col" className="px-2 text-left font-normal">
              名前
            </th>
            <th scope="col" className="px-2 text-right font-normal">
              この問題
            </th>
            <th scope="col" className="px-2 text-right font-normal">
              合計
            </th>
          </tr>
        </thead>
        <tbody>
          {standings.entries.map((entry) => {
            const isMe = entry.participantId === meId;
            return (
              <tr key={entry.participantId} className={isMe ? 'bg-primary text-primary-foreground' : 'bg-card'}>
                <td className="rounded-l-chip px-2 py-1.5 font-bold whitespace-nowrap tabular-nums">
                  <span className={numeral}>{entry.rank}</span>位
                </td>
                <td className="px-2 py-1.5">
                  <p className="flex items-baseline gap-2">
                    <span className="name-clip font-bold" title={entry.name}>
                      {entry.name}
                    </span>
                    {isMe && <MeChip />}
                  </p>
                </td>
                <td
                  className={`px-2 py-1.5 text-right tabular-nums ${entry.points === 0 && !isMe ? 'text-muted-foreground' : ''}`}
                >
                  +{formatPoints(entry.points)}
                </td>
                <td className={`rounded-r-chip px-2 py-1.5 text-right tabular-nums ${numeral}`}>
                  {formatPoints(entry.totalScore)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
