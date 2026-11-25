import { MAX_PARTICIPANTS, type Participants, type RoomSnapshot } from '@zubatto-quiz/protocol';
import { cva } from 'class-variance-authority';

import { JoinUrlCard } from './JoinUrlCard';

/**
 * 名前の長さに合わせたチップを折り返して並べる人数の上限。
 * 幅の上限（10em）のチップは、投影（1920×1080・1440×900）の参加者の列に、どの名前でも1行に3人は入る。
 * 30人なら10行で、1440×900 の一覧に入る11行に収まる。それより多いと、名前の長さで行の数が決まらないので、
 * 幅のそろった格子（1440・1920 とも5列）にする。50人なら10行になる
 */
const LOOSE_MAX_PARTICIPANTS = 30;

// Tailwind はクラス名を文字列のまま探すので、並べ方ごとのクラスは組み立てずに書いておく。
// oxfmt は cva の引数の class を並べ替える（.oxfmtrc.json の sortTailwindcss.functions）
const listVariants = cva('gap-2 text-stage-label', {
  variants: {
    layout: {
      loose: 'flex flex-wrap content-start',
      dense: 'grid grid-cols-[repeat(auto-fill,minmax(6em,1fr))]',
    },
  },
});

/** 格子では、マスの幅いっぱいに広げ、そこからはみ出す名前を省略する */
const chipVariants = cva('rounded-chip bg-secondary px-3 py-1', {
  variants: {
    layout: {
      loose: 'max-w-[10em]',
      dense: 'min-w-0',
    },
  },
});

interface HostLobbyProps {
  room: RoomSnapshot;
  participants: Participants['participants'];
  joinUrl: string;
}

/**
 * ホストの待機画面（F1・F3）。投影する画面なので、文字と余白は vw で伸びるトークンを使う。
 * md 以上は URL と参加者を横に並べ（投影）、それより狭いと縦に積む（ホストのスマホ）。
 * 投影（1920×1080・1440×900）では、進行の帯まで含めてスクロールなしの1画面に収める。
 * 名前は JSX の {name} で文字として描画する。innerHTML 系の API は使わない（ADR 0004）。
 * 参加者のチップは幅に上限を付け、長い名前は1行で省略して title で全文を見せる。
 * 折り返すと、長い名前の人が多いときに行が増えて、50人で1画面に収まらない。
 * 30人を超えたら、幅のそろった格子に並べる（LOOSE_MAX_PARTICIPANTS）
 */
export function HostLobby({ room, participants, joinUrl }: HostLobbyProps) {
  const layout = participants.length > LOOSE_MAX_PARTICIPANTS ? 'dense' : 'loose';
  return (
    <main className="flex flex-1 flex-col gap-stage p-stage">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="text-stage-title font-bold wrap-anywhere">{room.title}</h1>
        <p className="text-stage-label text-muted-foreground">全{room.questionCount}問</p>
      </header>

      {/* flex-1 で伸ばした高さを行に分けないよう、content-start で上に詰める。縦に積むと URL と参加者のあいだが空く */}
      <div className="grid flex-1 grid-cols-1 content-start gap-stage md:grid-cols-2">
        <div className="flex flex-col gap-4 self-start">
          <JoinUrlCard joinUrl={joinUrl} />
          {/* F2: ホストも同じ URL から回答者として入れる。この画面は進行に使うので、別のタブで開く */}
          <p className="text-note text-muted-foreground">
            ホストも回答者として遊ぶときは、別のタブで参加用の URL
            を開き、名前を入れてください。このタブは進行に使います。
            <a
              href={joinUrl}
              target="_blank"
              rel="noopener"
              className="ml-2 font-bold text-foreground underline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              回答者としても参加する
            </a>
          </p>
        </div>

        <section aria-labelledby="participants-heading" className="flex flex-col gap-4">
          <h2 id="participants-heading" className="flex items-baseline gap-3">
            <span className="text-stage-title font-bold">参加者</span>
            <span className="font-numeral text-question tabular-nums">{participants.length}</span>
            <span className="text-stage-label text-muted-foreground">/ {MAX_PARTICIPANTS} 人</span>
          </h2>
          {participants.length === 0 ? (
            <p className="text-stage-label text-muted-foreground">まだだれも入っていません</p>
          ) : (
            // 入った順に並ぶ。部屋の DO が join_order の順で送る
            <ul aria-labelledby="participants-heading" className={listVariants({ layout })}>
              {participants.map((participant) => (
                <li key={participant.participantId} className={chipVariants({ layout })}>
                  <span className="block name-clip" title={participant.name}>
                    {participant.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="border-t border-border pt-4">
        {/* ADR 0002: 部屋は作ったときの問題セットを写して使う。投影では1行に収め、待機画面の高さを増やさない */}
        <p className="text-note text-muted-foreground">
          部屋を作ったあとに問題セットを編集しても、この部屋には反映されません。直したいときは、部屋を作り直してください。
        </p>
      </footer>
    </main>
  );
}
