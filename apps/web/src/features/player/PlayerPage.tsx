import { useStore } from 'zustand';

import { ConnectionNotice } from './ConnectionNotice';
import { JoinForm } from './JoinForm';
import type { PlayerEntry, PlayerRoom } from './player-room';
import { WaitingRoom } from './WaitingRoom';

/**
 * 回答者の画面（F2・F3）。どの画面を出すかは player-room の entry が決め、ここは描くだけ。
 * 接続の開け閉めは route の onEnter・onLeave と「参加する」の押下が行うので、ここでは effect を使わない
 */
export function PlayerPage({ player }: { player: PlayerRoom }) {
  const entry = useStore(player.store, (state) => state.entry);

  switch (entry.screen) {
    case 'form':
      // 断られて戻るたびに入力欄を作り直し、残した名前と理由を出し直す
      return (
        <JoinForm
          key={`${entry.notice}:${entry.name}`}
          notice={entry.notice}
          defaultName={entry.name}
          onJoin={player.join}
        />
      );
    case 'full':
      return (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pb-24">
          <h1 className="font-display text-3xl leading-snug">この部屋は満員です</h1>
          <p className="mt-4 leading-relaxed text-on-stage-muted">
            1つの部屋に入れるのは50人までです。ホストに、別の部屋を作れるか聞いてください。
          </p>
        </main>
      );
    case 'room':
      return <InRoom entry={entry} />;
  }
}

/** 接続を開いたあとの画面。出題からあとの画面は T27 で足す */
function InRoom({ entry }: { entry: Extract<PlayerEntry, { screen: 'room' }> }) {
  const { connection, closeReason, room, me, participants } = useStore(entry.room);

  return (
    <ConnectionNotice connection={connection} closeReason={closeReason}>
      {room === null ? (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pb-24">
          <p role="status" className="text-lg font-bold">
            部屋に入っています…
          </p>
        </main>
      ) : (
        // join で入ったときは名前が届かないので、入れた名前を使う
        <WaitingRoom name={me?.name ?? entry.name ?? ''} participants={participants} persisted={entry.persisted} />
      )}
    </ConnectionNotice>
  );
}
