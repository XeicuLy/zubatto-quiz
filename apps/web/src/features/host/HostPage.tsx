import { useStore } from 'zustand';

import type { HostRoom } from './host-room';
import { HostConnectionNotice } from './HostConnectionNotice';
import { HostControls } from './HostControls';
import { HostLobby } from './HostLobby';
import { HostStage } from './HostStage';

/**
 * ホストの進行画面（F1・F3・F8・F16）。部屋の段階で出し分け、ここは描くだけ。
 * 上に投影する部分（待機・出題から最終ランキングまで）を、下に進行の操作の帯を置く。
 * 接続の開け閉めは route の onEnter・onLeave が行うので、ここでは effect を使わない
 */
export function HostPage({ host, joinUrl }: { host: HostRoom; joinUrl: string }) {
  const { connection, closeReason } = useStore(host.room);
  return (
    <HostConnectionNotice connection={connection} closeReason={closeReason}>
      <HostScreen host={host} joinUrl={joinUrl} />
    </HostConnectionNotice>
  );
}

function HostScreen({ host, joinUrl }: { host: HostRoom; joinUrl: string }) {
  const { room, participants, question, finalRanking } = useStore(host.room);

  // 他人の部屋やない部屋は、hostReady が届かずに 4404 で閉じられ、HostConnectionNotice が理由を出す
  if (room === null) {
    return <StatusScreen>部屋につないでいます…</StatusScreen>;
  }
  return (
    <div className="flex min-h-dvh flex-col">
      {room.phase === 'lobby' ? (
        <HostLobby room={room} participants={participants} joinUrl={joinUrl} />
      ) : (
        <HostStage room={room} question={question} finalRanking={finalRanking} participantCount={participants.length} />
      )}
      {/* 段階が変わったら作り直し、やり直し・終了を確かめている途中の表示を、次の段階へ持ち越さない */}
      <HostControls key={`${room.phase}:${room.questionIndex}`} room={room} onSend={host.send} />
    </div>
  );
}

function StatusScreen({ children }: { children: string }) {
  return (
    <main className="flex min-h-dvh flex-col justify-center p-stage">
      <p role="status" className="text-stage-title font-bold">
        {children}
      </p>
    </main>
  );
}
