import { createFileRoute, notFound } from '@tanstack/react-router';
import { roomIdSchema } from '@zubatto-quiz/protocol';

import { requireHost } from '../../../features/admin/host-session';
import { createHostRoom } from '../../../features/host/host-room';
import { HostPage } from '../../../features/host/HostPage';
import { roomJoinUrl, roomSocketUrl } from '../../../realtime/room-url';

/**
 * ホストの待機と進行（T31・T32）。一覧の「部屋を作る」が、作った部屋のここへ移る。
 * 部屋に入るときに loader が操作役（host-room）を1つ作り、onEnter でホスト用の接続を開き、onLeave で閉じる。
 * gcTime: 0 と shouldReload: false で、同じ部屋にいるあいだは作り直さず、離れたら捨てる
 */
export const Route = createFileRoute('/rooms/$roomId/host')({
  beforeLoad: async ({ params, context }) => {
    // 形の違う ID は接続しなくても部屋がないと分かるので、ログインを確かめるより先に止め、接続も開かない
    if (!roomIdSchema.safeParse(params.roomId).success) {
      throw notFound();
    }
    // ホスト用の入口は Cookie のセッションで持ち主を確かめる。ログインしていなければ 401 でつなぎ直しが続くので、先にログイン画面へ移す
    return requireHost({ context });
  },
  loader: ({ params, context }) => ({
    host: createHostRoom({
      url: roomSocketUrl(params.roomId, 'host', window.location),
      createSocket: context.createRoomSocket,
      sound: context.sound,
    }),
    joinUrl: roomJoinUrl(params.roomId, window.location),
  }),
  gcTime: 0,
  shouldReload: false,
  onEnter: (match) => match.loaderData?.host.connect(),
  onLeave: (match) => match.loaderData?.host.leave(),
  component: HostRoute,
});

function HostRoute() {
  const { host, joinUrl } = Route.useLoaderData();
  const { sound } = Route.useRouteContext();
  return (
    <div className="min-h-dvh bg-stage font-sans text-on-stage antialiased">
      <HostPage host={host} joinUrl={joinUrl} sound={sound} />
    </div>
  );
}
