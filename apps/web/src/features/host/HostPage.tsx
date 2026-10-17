import { useStore } from 'zustand';

import type { HostRoom } from './host-room';
import { HostConnectionNotice } from './HostConnectionNotice';
import { HostLobby } from './HostLobby';

/**
 * ホストの進行画面（F1・F3）。部屋の段階で出し分け、ここは描くだけ。
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
  const { room, participants } = useStore(host.room);

  // 他人の部屋やない部屋は、hostReady が届かずに 4404 で閉じられ、HostConnectionNotice が理由を出す
  if (room === null) {
    return <StatusScreen>部屋につないでいます…</StatusScreen>;
  }
  if (room.phase === 'lobby') {
    return <HostLobby room={room} participants={participants} joinUrl={joinUrl} />;
  }
  // 出題からあとの進行の画面は T32 で作る
  return <StatusScreen>進行中です</StatusScreen>;
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
