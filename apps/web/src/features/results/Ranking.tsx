import type { FinalRanking as FinalRankingMessage, Standings } from '@zubatto-quiz/protocol';
import type { Ref } from 'react';

import { formatPoints } from './format';
import type { Variant } from './variant';

/**
 * ③ 途中経過と最終ランキング（F15）。順位はサーバーが付けたまま出す。
 * 同点は同じ順位（1位・2位・2位・4位）で、同じ順位の人は入室した順に並んで届く（要件定義書の「同点のとき」）。
 * 回答者画面では meId を渡し、自分の行だけを強調する。進行画面では渡さない
 */

/** Tailwind はクラス名を文字列のまま探すので、大きさごとのクラスは組み立てずに書いておく */
const standingsSizes = {
  projector: {
    root: 'gap-stage p-stage',
    title: 'text-stage-title',
    sub: 'text-stage-label',
    table: 'text-stage-label',
  },
  mobile: { root: 'mt-6 gap-3', title: 'text-xl', sub: 'text-sm', table: 'text-sm' },
} as const;

export interface StandingsRankingProps {
  standings: Standings;
  variant: Variant;
  /** 回答者画面の自分。上位に入っていれば強調する */
  meId?: string;
  /** 進行画面がホストの操作のあとにフォーカスを移す見出し。渡したときだけ tabIndex={-1} にする */
  headingRef?: Ref<HTMLHeadingElement>;
}

/** ③ 途中経過。上位10人を、この問題の点と合計で出す */
export function StandingsRanking({ standings, variant, meId, headingRef }: StandingsRankingProps) {
  const size = standingsSizes[variant];
  return (
    <section aria-label="途中経過" className={`flex flex-col ${size.root}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className={`font-display focus-target ${size.title}`}
        >
          途中経過（第{standings.questionIndex + 1}問まで）
        </h2>
        <p className={`text-on-stage-muted ${size.sub}`}>
          上位{standings.entries.length}人 / {standings.participantCount}人
        </p>
      </header>
      {/* 名前は1行で省略し（name-clip）、行の高さをそろえる */}
      <table aria-label="途中経過" className={`w-full table-fixed border-separate border-spacing-y-1 ${size.table}`}>
        <colgroup>
          <col className="w-[3.5em]" />
          <col />
          <col className="w-[5em]" />
          <col className="w-[5em]" />
        </colgroup>
        <thead className="whitespace-nowrap text-on-stage-muted">
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
              <tr key={entry.participantId} className={isMe ? 'bg-on-stage text-stage' : 'bg-stage-raised'}>
                <td className="rounded-l-chip px-2 py-1.5 font-display whitespace-nowrap tabular-nums">
                  {entry.rank}位
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
                  className={`px-2 py-1.5 text-right tabular-nums ${entry.points === 0 && !isMe ? 'text-on-stage-muted' : ''}`}
                >
                  +{formatPoints(entry.points)}
                </td>
                <td className="rounded-r-chip px-2 py-1.5 text-right font-display tabular-nums">
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

const finalSizes = {
  projector: {
    root: 'gap-stage p-stage',
    title: 'text-stage-title',
    sub: 'text-stage-label',
    top: 'gap-stage md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]',
    winnerBox: 'p-stage',
    winnerLabel: 'text-stage-title',
    winnerName: 'text-question',
    unit: 'text-stage-title',
    podium: 'text-stage-title',
    // 投影では2列にして、人数が多くても1画面に収める。columns は人数によらず、左の列から縦に流す
    rest: 'gap-x-stage text-stage-label md:columns-2',
  },
  mobile: {
    root: 'mt-6 gap-4',
    title: 'text-2xl',
    sub: 'text-sm',
    top: 'gap-4',
    winnerBox: 'p-5',
    winnerLabel: 'text-lg',
    winnerName: 'text-3xl',
    unit: 'text-lg',
    podium: 'text-lg',
    rest: 'text-base',
  },
} as const;

export interface FinalRankingProps {
  ranking: FinalRankingMessage;
  variant: Variant;
  /** 回答者画面の自分。どの順位にいても強調する */
  meId?: string;
  /** 進行画面がホストの操作のあとにフォーカスを移す見出し。渡したときだけ tabIndex={-1} にする */
  headingRef?: Ref<HTMLHeadingElement>;
}

type RankedEntry = FinalRankingMessage['entries'][number];

/** 最終ランキング。優勝（1位が同点なら全員）だけを spotlight にし、全員の順位を出す */
export function FinalRanking({ ranking, variant, meId, headingRef }: FinalRankingProps) {
  const size = finalSizes[variant];
  const winners = ranking.entries.filter((entry) => entry.rank === 1);
  const podium = ranking.entries.filter((entry) => entry.rank === 2 || entry.rank === 3);
  const rest = ranking.entries.filter((entry) => entry.rank >= 4);

  return (
    <section aria-label="最終ランキング" className={`flex flex-col ${size.root}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          className={`font-display focus-target ${size.title}`}
        >
          最終ランキング
        </h2>
        <p className={`text-on-stage-muted ${size.sub}`}>
          全{ranking.questionCount}問 / {ranking.entries.length}人
        </p>
      </header>

      {winners.length === 0 ? (
        <p className="font-bold">参加者はいませんでした</p>
      ) : (
        <div className={`grid ${size.top}`}>
          <section
            aria-label="優勝"
            className={`flex flex-col justify-center gap-2 rounded-panel bg-spotlight text-on-spotlight motion-safe:animate-spotlight-in ${size.winnerBox}`}
          >
            <p className={`font-display ${size.winnerLabel}`}>優勝</p>
            {winners.map((entry) => (
              <div key={entry.participantId}>
                <p className={`name-wrap font-display ${size.winnerName}`}>
                  {entry.name}
                  {entry.participantId === meId && (
                    <span className="ml-3 inline-block rounded-full bg-on-spotlight px-2 align-middle font-sans text-xs font-bold text-spotlight">
                      あなた
                    </span>
                  )}
                </p>
                <p className={`font-display whitespace-nowrap tabular-nums ${size.winnerName}`}>
                  {formatPoints(entry.totalScore)}
                  <span className={`ml-2 ${size.unit}`}>点</span>
                </p>
              </div>
            ))}
          </section>

          {podium.length > 0 && (
            <ol aria-label="2位と3位" className={`grid grid-cols-1 content-start gap-2 ${size.podium}`}>
              {podium.map((entry) => (
                <RankRow
                  key={entry.participantId}
                  entry={entry}
                  isMe={entry.participantId === meId}
                  className="rounded-panel px-4 py-2 font-bold"
                  idleClassName="bg-stage-raised"
                />
              ))}
            </ol>
          )}
        </div>
      )}

      {rest.length > 0 && (
        <ol aria-label="4位から下" className={size.rest}>
          {rest.map((entry) => (
            <RankRow
              key={entry.participantId}
              entry={entry}
              isMe={entry.participantId === meId}
              className="break-inside-avoid border-b border-stage-line px-2 py-1"
              idleClassName=""
            />
          ))}
        </ol>
      )}
    </section>
  );
}

interface RankRowProps {
  entry: RankedEntry;
  isMe: boolean;
  className: string;
  /** 自分でない行の色 */
  idleClassName: string;
}

function RankRow({ entry, isMe, className, idleClassName }: RankRowProps) {
  return (
    <li className={`flex items-center gap-4 ${className} ${isMe ? 'bg-on-stage text-stage' : idleClassName}`}>
      <span className="w-[2.8em] shrink-0 font-display whitespace-nowrap tabular-nums">{entry.rank}位</span>
      <span className="name-clip flex-1" title={entry.name}>
        {entry.name}
      </span>
      {isMe && <MeChip />}
      <span className="shrink-0 font-display tabular-nums">{formatPoints(entry.totalScore)}</span>
    </li>
  );
}

function MeChip() {
  return <span className="shrink-0 rounded-full bg-stage px-2 font-sans text-xs text-on-stage">あなた</span>;
}
