import type { Participants } from '@zubatto-quiz/protocol';

interface WaitingRoomProps {
  /** 自分の名前 */
  name: string;
  participants: Participants['participants'];
  /** 秘密を localStorage に保存できたか。できなければ、読み込み直すと戻れない */
  persisted: boolean;
}

/**
 * 待機画面（F3）。名前は JSX の {name} で文字として描画する。innerHTML 系の API は使わない（ADR 0004）。
 * 名前は全部見せたい場所なので name-wrap で折り返す
 */
export function WaitingRoom({ name, participants, persisted }: WaitingRoomProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-10 pb-24">
      <p className="text-on-stage-muted">参加しました</p>
      <h1 className="mt-2 name-wrap text-4xl leading-snug font-bold">{name}</h1>
      {!persisted && (
        <p className="mt-4 rounded-chip border-2 border-alert px-4 py-3 text-sm leading-relaxed">
          このブラウザでは参加の情報を保存できないため、ページを読み込み直すと、この名前と得点には戻れません。
        </p>
      )}

      <div className="mt-8 rounded-panel border-2 border-dashed border-stage-line p-6 text-center">
        <p className="text-lg font-bold">ホストが始めるのを待っています</p>
        <p className="mt-2 text-on-stage-muted">
          いま <span className="text-2xl font-bold text-on-stage">{participants.length}</span> 人が参加中
        </p>
      </div>

      <h2 id="participants-heading" className="mt-8 font-bold text-on-stage-muted">
        参加者
      </h2>
      <ul aria-labelledby="participants-heading" className="mt-3 flex flex-wrap gap-2">
        {participants.map((participant) => (
          <li key={participant.participantId} className="name-wrap rounded-chip bg-stage-raised px-3 py-1.5">
            {participant.name}
          </li>
        ))}
      </ul>
    </main>
  );
}
