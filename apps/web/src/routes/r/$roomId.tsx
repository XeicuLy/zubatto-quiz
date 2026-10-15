import { createFileRoute, notFound } from '@tanstack/react-router';
import { roomIdSchema } from '@zubatto-quiz/protocol';

import { createPlayerRoom } from '../../features/player/player-room';
import { PlayerPage } from '../../features/player/PlayerPage';
import { roomSocketUrl } from '../../realtime/room-url';

/**
 * 回答者の入室・待機・回答（T26・T27）。
 * 部屋に入るときに loader が操作役（player-room）を1つ作り、onEnter で保存した秘密の resume を始め、onLeave で接続を閉じる。
 * gcTime: 0 と shouldReload: false で、同じ部屋にいるあいだは作り直さず、離れたら捨てる
 */
export const Route = createFileRoute('/r/$roomId')({
  beforeLoad: ({ params }) => {
    // 形の違う ID で開くと、API が 404 で断り、接続が切れてつなぎ直しが続くので、開く前に止める
    if (!roomIdSchema.safeParse(params.roomId).success) {
      throw notFound();
    }
  },
  loader: ({ params, context }) =>
    createPlayerRoom({
      roomId: params.roomId,
      url: roomSocketUrl(params.roomId, 'play', window.location),
      createSocket: context.createRoomSocket,
    }),
  gcTime: 0,
  shouldReload: false,
  onEnter: (match) => match.loaderData?.resumeSaved(),
  onLeave: (match) => match.loaderData?.leave(),
  component: PlayerRoute,
});

function PlayerRoute() {
  return (
    <div className="min-h-dvh bg-stage font-sans text-on-stage antialiased">
      <PlayerPage player={Route.useLoaderData()} />
    </div>
  );
}
