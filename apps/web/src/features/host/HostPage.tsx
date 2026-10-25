import type { HostCommand } from '@zubatto-quiz/protocol';
import { useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';

import { roomEndOf } from '../results/room-end';
import type { SoundPlayer } from '../sound/sound-player';
import { type Stage, stageAfter } from './host-commands';
import type { HostRoom } from './host-room';
import { HostConnectionNotice, HostEndedBar } from './HostConnectionNotice';
import { HostControls } from './HostControls';
import { HostLobby } from './HostLobby';
import { HostStage } from './HostStage';

/**
 * ホストの進行画面（F1・F3・F8・F16）。部屋の段階で出し分け、ここは描くだけ。
 * 上に投影する部分（待機・出題から最終ランキングまで）を、下に進行の操作の帯を置く。
 * 接続の開け閉めは route の onEnter・onLeave が行うので、ここでは effect を使わない
 */
export function HostPage({ host, joinUrl, sound }: { host: HostRoom; joinUrl: string; sound: SoundPlayer }) {
  const state = useStore(host.room);
  const roomEnd = roomEndOf(state);
  return (
    <HostConnectionNotice connection={state.connection} closeReason={state.closeReason} roomEnd={roomEnd}>
      <HostScreen host={host} joinUrl={joinUrl} sound={sound} ended={roomEnd === 'after_final'} />
    </HostConnectionNotice>
  );
}

function HostScreen({
  host,
  joinUrl,
  sound,
  ended,
}: {
  host: HostRoom;
  joinUrl: string;
  sound: SoundPlayer;
  ended: boolean;
}) {
  const { room, participants, question, finalRanking, connection } = useStore(host.room);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // ホストがこのタブで押し、段階が変わるはずの操作を送ったときの行き先。アラームの締切や別のタブの操作では付かない
  const pendingFocus = useRef<Stage | null>(null);
  const phase = room?.phase;
  const questionIndex = room?.questionIndex;

  // 返事の前に切れたら印を捨てる。つなぎ直したあとの段階は、送った操作で変わったのか別のタブの操作で変わったのか分からない。
  // 今は HostConnectionNotice の木の形が変わってこの画面ごと作り直されるので消えるが、その形に頼らない
  useLayoutEffect(() => {
    if (connection === 'reconnecting' || connection === 'closed') {
      pendingFocus.current = null;
    }
  }, [connection]);

  // 押したボタンは帯ごと作り直されて消え、フォーカスが <body> に落ちる。新しい段階を描いたら、その見出しへ移す。
  // 主ボタンへ移さないのは、Enter を続けて押すと ① から ② へ、見せずに進んでしまうから。
  // 行き先と違う段階に移ったら、送った操作は断られている（締切を過ぎたやり直しは、先に ① が届いてから断られる）。
  // 部屋の DO は1本の接続のメッセージを順に処理するので、断られた返事より先に、その段階の配信が届く
  useLayoutEffect(() => {
    const expected = pendingFocus.current;
    pendingFocus.current = null;
    if (expected !== null && expected.phase === phase && expected.questionIndex === questionIndex) {
      headingRef.current?.focus();
    }
  }, [phase, questionIndex]);

  function send(command: HostCommand): boolean {
    const sent = host.send(command);
    if (sent && room !== null) {
      pendingFocus.current = stageAfter(room, command);
    }
    return sent;
  }

  // 他人の部屋やない部屋は、hostReady が届かずに 4404 で閉じられ、HostConnectionNotice が理由を出す
  if (room === null) {
    return <StatusScreen>部屋につないでいます…</StatusScreen>;
  }
  return (
    <div className="flex min-h-dvh flex-col">
      {room.phase === 'lobby' ? (
        <HostLobby room={room} participants={participants} joinUrl={joinUrl} />
      ) : (
        <HostStage
          room={room}
          question={question}
          finalRanking={finalRanking}
          participantCount={participants.length}
          headingRef={headingRef}
        />
      )}
      {ended ? (
        <HostEndedBar />
      ) : (
        // 段階が変わったら作り直し、やり直し・終了を確かめている途中の表示を、次の段階へ持ち越さない
        <HostControls key={`${room.phase}:${room.questionIndex}`} room={room} onSend={send} sound={sound} />
      )}
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
