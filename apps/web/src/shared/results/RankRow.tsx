import type { FinalRanking as FinalRankingMessage } from '@zubatto-quiz/protocol';
import { cva } from 'class-variance-authority';

import { formatPoints } from './format';
import type { Variant } from './variant';

// oxfmt は cva の引数の class を並べ替える（.oxfmtrc.json の sortTailwindcss.functions）。定数の表に入れると並べ替えないので、cva で書く

/** 順位と点の数字の字体。飾り文字は投影の数字・順位だけ。回答者画面の数字は本文の字体の太字にする */
export const numeralVariants = cva('', {
  variants: {
    variant: {
      projector: 'font-numeral',
      mobile: 'font-bold',
    },
  },
});

/** 文字の大きさは並べる側（ol）が決めるので、行は形と色だけを持つ */
const rowVariants = cva('flex items-center gap-4', {
  variants: {
    emphasis: {
      podium: 'rounded-panel px-4 py-2 font-bold',
      rest: 'break-inside-avoid border-b border-border px-2 py-1',
    },
    isMe: {
      true: 'bg-primary text-primary-foreground',
      false: '',
    },
  },
  compoundVariants: [{ emphasis: 'podium', isMe: false, class: 'bg-card' }],
});

type RankedEntry = FinalRankingMessage['entries'][number];

export interface RankRowProps {
  /** サーバーが付けた順位と合計。ここでは数えない */
  entry: RankedEntry;
  /** 投影（projector）では、順位と点の数字を飾り文字にする */
  variant: Variant;
  /** 2位と3位（podium）は1人ずつの札に、4位から下（rest）は罫線で区切った行にする */
  emphasis: 'podium' | 'rest';
  /** 回答者画面の自分の行。色を変え、「あなた」を付ける */
  isMe: boolean;
}

/** 最終ランキングの、優勝より下の1人分の行。ol の中に置く */
export function RankRow({ entry, variant, emphasis, isMe }: RankRowProps) {
  const numeral = numeralVariants({ variant });
  return (
    <li className={rowVariants({ emphasis, isMe })}>
      <span className="w-[2.8em] shrink-0 font-bold whitespace-nowrap tabular-nums">
        <span className={numeral}>{entry.rank}</span>位
      </span>
      <span className="name-clip flex-1" title={entry.name}>
        {entry.name}
      </span>
      {isMe && <MeChip />}
      <span className={`shrink-0 tabular-nums ${numeral}`}>{formatPoints(entry.totalScore)}</span>
    </li>
  );
}

/** 自分の行に付ける印。色を変えた行の上に置くので、行の色を反転させる */
export function MeChip() {
  return <span className="shrink-0 rounded-full bg-primary-foreground px-2 text-xs text-primary">あなた</span>;
}
