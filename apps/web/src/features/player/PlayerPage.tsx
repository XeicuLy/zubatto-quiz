import { MAX_PARTICIPANTS } from '@zubatto-quiz/protocol';
import { useStore } from 'zustand';

import { FinalRanking } from '../results/Ranking';
import { roomEndOf } from '../results/room-end';
import type { SoundPlayer } from '../sound/sound-player';
import { SoundToggle } from '../sound/SoundToggle';
import { ConnectionNotice } from './ConnectionNotice';
import { JoinForm } from './JoinForm';
import type { PlayerEntry, PlayerRoom } from './player-room';
import { QuestionView } from './QuestionView';
import { ResultView } from './ResultView';
import { WaitingRoom } from './WaitingRoom';

/**
 * 回答者の画面（F2・F3・F10・F17）。どの画面を出すかは player-room の entry が決め、ここは描くだけ。
 * 接続の開け閉めは route の onEnter・onLeave と「参加する」の押下が行うので、ここでは effect を使わない
 */
export function PlayerPage({ player, sound }: { player: PlayerRoom; sound: SoundPlayer }) {
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
            1つの部屋に入れるのは{MAX_PARTICIPANTS}人までです。ホストに、別の部屋を作れるか聞いてください。
          </p>
        </main>
      );
    case 'not_found':
      return (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pb-24">
          <h1 className="font-display text-3xl leading-snug">部屋が見つかりません</h1>
          <p className="mt-4 leading-relaxed text-on-stage-muted">URL が正しいか、ホストに確かめてください。</p>
        </main>
      );
    case 'room':
      return <InRoom entry={entry} onAnswer={player.answer} sound={sound} />;
  }
}

/**
 * 接続を開いたあとの画面。部屋の段階で出し分ける。
 * 効果音の切り替え（F18）は、どの段階でも右下に置く。どの画面も下に pb-24 の余白があるので、ボタンや結果に重ならない
 */
function InRoom({
  entry,
  onAnswer,
  sound,
}: {
  entry: Extract<PlayerEntry, { screen: 'room' }>;
  onAnswer: PlayerRoom['answer'];
  sound: SoundPlayer;
}) {
  const state = useStore(entry.room);
  return (
    <>
      <ConnectionNotice connection={state.connection} closeReason={state.closeReason} roomEnd={roomEndOf(state)}>
        <RoomScreen entry={entry} onAnswer={onAnswer} />
      </ConnectionNotice>
      <SoundToggle
        sound={sound}
        className="fixed right-4 bottom-4 z-10 rounded-full border border-stage-line bg-stage-raised px-4 py-2 text-sm font-bold shadow-panel focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-on-stage"
      />
    </>
  );
}

function RoomScreen({
  entry,
  onAnswer,
}: {
  entry: Extract<PlayerEntry, { screen: 'room' }>;
  onAnswer: PlayerRoom['answer'];
}) {
  const { room, me, question, participants, finalRanking } = useStore(entry.room);
  // join で入ったときは名前が届かないので、入れた名前を使う
  const name = me?.name ?? entry.name ?? '';

  if (room === null) {
    return <StatusScreen>部屋に入っています…</StatusScreen>;
  }
  if (room.phase === 'lobby') {
    return <WaitingRoom name={name} participants={participants} persisted={entry.persisted} />;
  }
  if (room.phase === 'final') {
    // つなぎ直したときは、hostReady などのすぐあとに finalRanking が送り直される
    return finalRanking === null ? (
      <StatusScreen>最終の結果を発表しています</StatusScreen>
    ) : (
      <main className="mx-auto min-h-dvh max-w-md px-5 pt-4 pb-24">
        <FinalRanking ranking={finalRanking} variant="mobile" meId={me?.participantId} />
      </main>
    );
  }
  if (question === null) {
    // 出題からあとの段階でつなぎ直すと、resumed のすぐあとに今の問題が送り直される
    return <StatusScreen>部屋に入っています…</StatusScreen>;
  }
  if (question.myResult !== null && me !== null) {
    // 締切の集計が届いたら結果を出す。届くまでは QuestionView が締切の表示を続ける
    return (
      <ResultView
        question={question}
        myResult={question.myResult}
        phase={room.phase}
        questionCount={room.questionCount}
        meId={me.participantId}
      />
    );
  }
  return (
    <QuestionView
      // 次の問題に移ったら作り直し、押した印と計測を前の問題から持ち越さない
      key={question.questionId}
      question={question}
      phase={room.phase}
      questionCount={room.questionCount}
      name={name}
      onAnswer={onAnswer}
    />
  );
}

function StatusScreen({ children }: { children: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 pb-24">
      <p role="status" className="text-lg font-bold">
        {children}
      </p>
    </main>
  );
}
