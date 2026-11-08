import type { FinalRanking as FinalRankingMessage } from '@zubatto-quiz/protocol';
import { cva } from 'class-variance-authority';
import type { Ref } from 'react';

import { formatPoints } from './format';
import { numeralVariants, RankRow } from './RankRow';
import type { Variant } from './variant';

// Tailwind はクラス名を文字列のまま探すので、大きさごとのクラスは組み立てずに書いておく。
// oxfmt は cva の引数の class を並べ替える（.oxfmtrc.json の sortTailwindcss.functions）。定数の表に入れると並べ替えないので、cva で書く

const rootVariants = cva('flex flex-col', {
  variants: {
    variant: {
      projector: 'gap-stage p-stage',
      mobile: 'mt-6 gap-4',
    },
  },
});

const titleVariants = cva('font-bold focus-target', {
  variants: {
    variant: {
      projector: 'text-stage-title',
      mobile: 'text-title',
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

/** 優勝の箱と、2位と3位の列。投影では横に並べる */
const topVariants = cva('grid', {
  variants: {
    variant: {
      projector: 'gap-stage md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]',
      mobile: 'gap-4',
    },
  },
});

const winnerBoxVariants = cva(
  'flex flex-col justify-center gap-2 rounded-panel bg-spotlight text-spotlight-foreground motion-safe:animate-spotlight-in',
  {
    variants: {
      variant: {
        projector: 'p-stage',
        mobile: 'p-5',
      },
    },
  },
);

/** 優勝の箱の「優勝」の文字 */
const winnerLabelVariants = cva('font-bold', {
  variants: {
    variant: {
      projector: 'text-stage-title',
      mobile: 'text-heading',
    },
  },
});

/** 優勝した人の名前と点。名前は折り返し、点は折り返さない */
const winnerNameVariants = cva('font-bold', {
  variants: {
    variant: {
      projector: 'text-question',
      mobile: 'text-title',
    },
    part: {
      name: 'name-wrap',
      score: 'whitespace-nowrap tabular-nums',
    },
  },
});

const unitVariants = cva('ml-2', {
  variants: {
    variant: {
      projector: 'text-stage-title',
      mobile: 'text-heading',
    },
  },
});

const podiumVariants = cva('grid grid-cols-1 content-start gap-2', {
  variants: {
    variant: {
      projector: 'text-stage-title',
      mobile: 'text-heading',
    },
  },
});

const restVariants = cva('', {
  variants: {
    variant: {
      // 投影では2列にして、人数が多くても1画面に収める。columns は人数によらず、左の列から縦に流す
      projector: 'gap-x-stage text-stage-label md:columns-2',
      mobile: 'text-body',
    },
  },
});

export interface FinalRankingProps {
  ranking: FinalRankingMessage;
  variant: Variant;
  /** 回答者画面の自分。どの順位にいても強調する */
  meId?: string;
  /** 進行画面がホストの操作のあとにフォーカスを移す見出し。渡したときだけ tabIndex={-1} にする */
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * 最終ランキング（F15）。優勝（1位が同点なら全員）だけを spotlight にし、全員の順位を出す。
 * 順位はサーバーが付けたまま出す。同点は同じ順位で、同じ順位の人は入室した順に並んで届く（要件定義書の「同点のとき」）。
 * 回答者画面では meId を渡し、どの順位にいても自分を強調する。進行画面では渡さない
 */
export function FinalRanking({ ranking, variant, meId, headingRef }: FinalRankingProps) {
  const winners = ranking.entries.filter((entry) => entry.rank === 1);
  const podium = ranking.entries.filter((entry) => entry.rank === 2 || entry.rank === 3);
  const rest = ranking.entries.filter((entry) => entry.rank >= 4);

  return (
    <section aria-label="最終ランキング" className={rootVariants({ variant })}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className={titleVariants({ variant })}>
          最終ランキング
        </h2>
        <p className={subVariants({ variant })}>
          全{ranking.questionCount}問 / {ranking.entries.length}人
        </p>
      </header>

      {winners.length === 0 ? (
        <p className="font-bold">参加者はいませんでした</p>
      ) : (
        <div className={topVariants({ variant })}>
          <section aria-label="優勝" className={winnerBoxVariants({ variant })}>
            <p className={winnerLabelVariants({ variant })}>優勝</p>
            {winners.map((entry) => (
              <div key={entry.participantId}>
                <p className={winnerNameVariants({ variant, part: 'name' })}>
                  {entry.name}
                  {entry.participantId === meId && (
                    <span className="ml-3 inline-block rounded-full bg-spotlight-foreground px-2 align-middle text-note font-bold text-spotlight">
                      あなた
                    </span>
                  )}
                </p>
                <p className={winnerNameVariants({ variant, part: 'score' })}>
                  <span className={numeralVariants({ variant })}>{formatPoints(entry.totalScore)}</span>
                  <span className={unitVariants({ variant })}>点</span>
                </p>
              </div>
            ))}
          </section>

          {podium.length > 0 && (
            <ol aria-label="2位と3位" className={podiumVariants({ variant })}>
              {podium.map((entry) => (
                <RankRow
                  key={entry.participantId}
                  entry={entry}
                  variant={variant}
                  emphasis="podium"
                  isMe={entry.participantId === meId}
                />
              ))}
            </ol>
          )}
        </div>
      )}

      {rest.length > 0 && (
        <ol aria-label="4位から下" className={restVariants({ variant })}>
          {rest.map((entry) => (
            <RankRow
              key={entry.participantId}
              entry={entry}
              variant={variant}
              emphasis="rest"
              isMe={entry.participantId === meId}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
