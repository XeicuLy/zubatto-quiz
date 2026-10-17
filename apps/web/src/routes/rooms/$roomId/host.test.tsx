import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import { CLOSE_CODES } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { stubFakeApi } from '../../../../test/fake-api';
import { FakeRoomServer } from '../../../../test/fake-room-server';
import { createAppRouter } from '../../../router';

const ROOM_ID = 'a'.repeat(64);
const ROOM = { title: '内輪クイズ', questionCount: 10, phase: 'lobby', questionIndex: null } as const;
const TARO = { participantId: '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e61', name: 'たろう' };

async function openHostPage(path = `/rooms/${ROOM_ID}/host`) {
  const server = new FakeRoomServer();
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    createRoomSocket: server.createSocket,
  });
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  return { server, router };
}

/** ホスト用の接続を開き、部屋の DO と同じく hostReady と participants を送る */
function acceptHost(server: FakeRoomServer, participants = [TARO]) {
  act(() => {
    server.latest.open();
    server.latest.emit({ type: 'hostReady', room: ROOM });
    server.latest.emit({ type: 'participants', participants });
  });
}

describe('ホストの待機画面の入口（F1・F3・ADR 0003）', () => {
  it('ホスト用の入口でつなぎ、参加用の URL と参加者を出す', async () => {
    stubFakeApi();
    const { server } = await openHostPage();

    expect(server.sockets).toHaveLength(1);
    expect(server.latest.url).toBe(`ws://localhost:3000/api/rooms/${ROOM_ID}/ws/host`);
    acceptHost(server);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('内輪クイズ');
    expect(screen.getByText(`http://localhost:3000/r/${ROOM_ID}`)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /参加者/ })).toHaveTextContent('たろう');
  });

  it('入室のたびに届く参加者一覧で、表示を置き換える（F3）', async () => {
    stubFakeApi();
    const { server } = await openHostPage();
    acceptHost(server, []);

    act(() => server.latest.emit({ type: 'participants', participants: [TARO] }));

    expect(screen.getByRole('list', { name: /参加者/ })).toHaveTextContent('たろう');
  });

  it('hostReady が届くまでは、つないでいることを出す', async () => {
    stubFakeApi();
    await openHostPage();

    expect(screen.getByRole('status')).toHaveTextContent('部屋につないでいます');
  });

  it('ログインしていなければ、ログイン画面へ移り、接続を開かない（S1）', async () => {
    stubFakeApi({ hostName: null });
    const { server, router } = await openHostPage();

    expect(router.state.location.pathname).toBe('/login');
    expect(server.sockets).toHaveLength(0);
  });

  it.each(['abc', 'A'.repeat(64)])(
    '部屋 ID の形が違う /rooms/%s/host は「ページが見つかりません」を出し、接続を開かない',
    async (roomId) => {
      const api = stubFakeApi();
      const { server } = await openHostPage(`/rooms/${roomId}/host`);

      expect(await screen.findByRole('heading', { level: 1, name: 'ページが見つかりません' })).toBeInTheDocument();
      expect(server.sockets).toHaveLength(0);
      // 形が違うと分かれば、ログインの確認より先に止める
      expect(api.received).toEqual([]);
    },
  );

  it('切れたら、画面を残したまま、つなぎ直していることを出す（A1）', async () => {
    stubFakeApi();
    const { server } = await openHostPage();
    acceptHost(server);

    act(() => server.latest.closeFromServer(1006));

    // 待機画面にも URL のコピーの知らせ（role="status"）があるので、文から探す
    expect(screen.getByText(/つなぎ直しています/).closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('内輪クイズ');
  });

  it('部屋が終わったら、そう出す', async () => {
    stubFakeApi();
    const { server } = await openHostPage();
    acceptHost(server);

    act(() => server.latest.closeFromServer(CLOSE_CODES.room_ended));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('この部屋は終わりました');
    expect(screen.getByRole('link', { name: '問題セットの一覧に戻る' })).toHaveAttribute('href', '/admin');
  });

  it('画面を離れたら接続を閉じる', async () => {
    stubFakeApi();
    const { server, router } = await openHostPage();
    acceptHost(server);

    await act(() => router.navigate({ to: '/admin' }));

    expect(server.latest.readyState).toBe(WebSocket.CLOSED);
  });
});
