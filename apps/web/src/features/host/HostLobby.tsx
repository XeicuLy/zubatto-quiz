import { MAX_PARTICIPANTS, type Participants, type RoomSnapshot } from '@zubatto-quiz/protocol';

import { JoinUrlCard } from './JoinUrlCard';

interface HostLobbyProps {
  room: RoomSnapshot;
  participants: Participants['participants'];
  joinUrl: string;
}

/**
 * ホストの待機画面（F1・F3）。投影する画面なので、文字と余白は vw で伸びるトークンを使う。
 * md 以上は URL と参加者を横に並べ（投影）、それより狭いと縦に積む（ホストのスマホ）。
 * 名前は JSX の {name} で文字として描画する。innerHTML 系の API は使わない（ADR 0004）。
 * 参加者の一覧は全部見せたい場所なので name-wrap で折り返す
 */
export function HostLobby({ room, participants, joinUrl }: HostLobbyProps) {
  return (
    <main className="flex flex-1 flex-col gap-stage p-stage">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="font-display text-stage-title wrap-anywhere">{room.title}</h1>
        <p className="text-stage-label text-on-stage-muted">全{room.questionCount}問</p>
      </header>

      {/* flex-1 で伸ばした高さを行に分けないよう、content-start で上に詰める。縦に積むと URL と参加者のあいだが空く */}
      <div className="grid flex-1 grid-cols-1 content-start gap-stage md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-4 self-start">
          <JoinUrlCard joinUrl={joinUrl} />
          {/* F2: ホストも同じ URL から回答者として入れる。この画面は進行に使うので、別のタブで開く */}
          <p className="text-sm leading-relaxed text-on-stage-muted">
            ホストも回答者として遊ぶときは、別のタブで参加用の URL
            を開き、名前を入れてください。このタブは進行に使います。
            <a
              href={joinUrl}
              target="_blank"
              rel="noopener"
              className="ml-2 font-bold text-on-stage underline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-on-stage"
            >
              回答者としても参加する
            </a>
          </p>
        </div>

        <section aria-labelledby="participants-heading" className="flex flex-col gap-4">
          <h2 id="participants-heading" className="flex items-baseline gap-3">
            <span className="font-display text-stage-title">参加者</span>
            <span className="font-display text-question tabular-nums">{participants.length}</span>
            <span className="text-stage-label text-on-stage-muted">/ {MAX_PARTICIPANTS} 人</span>
          </h2>
          {participants.length === 0 ? (
            <p className="text-stage-label text-on-stage-muted">まだだれも入っていません</p>
          ) : (
            // 入った順に並ぶ。部屋の DO が join_order の順で送る
            <ul aria-labelledby="participants-heading" className="flex flex-wrap content-start gap-2 text-stage-label">
              {participants.map((participant) => (
                <li key={participant.participantId} className="name-wrap rounded-chip bg-stage-raised px-3 py-1">
                  {participant.name}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="border-t border-stage-line pt-4">
        {/* ADR 0002: 部屋は作ったときの問題セットを写して使う */}
        <p className="max-w-[60ch] text-sm leading-relaxed text-on-stage-muted">
          部屋を作ったあとに問題セットを編集しても、この部屋には反映されません。直したいときは、部屋を作り直してください。
        </p>
      </footer>
    </main>
  );
}
