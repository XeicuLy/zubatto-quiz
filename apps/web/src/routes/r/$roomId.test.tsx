import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CLOSE_CODES } from '@zubatto-quiz/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeRoomServer } from '../../../test/fake-room-server';
import { createToken, loadToken, saveToken } from '../../features/player/token-storage';
import { createAppRouter } from '../../router';

const ROOM_ID = 'a'.repeat(64);
const ROOM = { title: 'テスト', questionCount: 3, phase: 'lobby', questionIndex: null } as const;
const ME = '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e61';
const OTHER = '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e62';

async function openPlayerPage(path = `/r/${ROOM_ID}`) {
  const server = new FakeRoomServer();
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    createRoomSocket: server.createSocket,
  });
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  return { server, router };
}

async function joinAs(name: string) {
  fireEvent.change(await screen.findByLabelText('名前'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: '参加する' }));
}

beforeEach(() => {
  localStorage.clear();
});

describe('回答者の入室と待機（F2・F3）', () => {
  it('URL を開いて名前を入れるだけで入室し、待機画面に参加者一覧が出る', async () => {
    const { server } = await openPlayerPage();

    expect(server.sockets).toHaveLength(0);
    await joinAs('たろう');
    act(() => server.latest.open());

    expect(server.latest.url).toBe(`ws://localhost:3000/api/rooms/${ROOM_ID}/ws/play`);
    expect(server.latest.received).toEqual([{ type: 'join', name: 'たろう', token: loadToken(ROOM_ID) }]);

    act(() => {
      server.latest.emit({ type: 'joined', participantId: ME, room: ROOM });
      server.latest.emit({
        type: 'participants',
        participants: [
          { participantId: OTHER, name: 'はなこ' },
          { participantId: ME, name: 'たろう' },
        ],
      });
    });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('たろう');
    expect(screen.getByRole('list', { name: '参加者' })).toHaveTextContent('はなこたろう');
  });

  it('保存した秘密があれば、名前を聞かずに resume し、届いた名前で待機画面を出す', async () => {
    const token = createToken();
    saveToken(ROOM_ID, token);
    const { server } = await openPlayerPage();

    expect(screen.queryByLabelText('名前')).toBeNull();
    act(() => server.latest.open());
    expect(server.latest.received).toEqual([{ type: 'resume', token }]);

    act(() => server.latest.emit({ type: 'resumed', participantId: ME, name: 'たろう', score: 0, room: ROOM }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('たろう');
  });

  it('秘密はアドレスバーの URL に出ない（ADR 0004）', async () => {
    const { server, router } = await openPlayerPage();

    await joinAs('たろう');
    act(() => server.latest.open());

    const token = loadToken(ROOM_ID)!;
    expect(router.state.location.href).toBe(`/r/${ROOM_ID}`);
    expect(router.state.location.href).not.toContain(token);
    expect(window.location.href).not.toContain(token);
  });
});

describe('断られたとき・閉じられたとき（ADR 0004）', () => {
  it('resume に失敗したら、秘密を消して名前の入力に戻る', async () => {
    saveToken(ROOM_ID, createToken());
    const { server } = await openPlayerPage();

    act(() => {
      server.latest.open();
      server.latest.closeFromServer(CLOSE_CODES.resume_failed);
    });

    expect(loadToken(ROOM_ID)).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('前回の参加には戻れませんでした');
    expect(screen.getByLabelText('名前')).toBeInTheDocument();
  });

  it('名前がかぶったら、名前の入力に戻り、入れ直せる', async () => {
    const { server } = await openPlayerPage();

    await joinAs('たろう');
    act(() => {
      server.latest.open();
      server.latest.closeFromServer(CLOSE_CODES.name_taken);
    });

    expect(screen.getByRole('alert')).toHaveTextContent('「たろう」はこの部屋でもう使われています');
    await joinAs('じろう');
    act(() => server.latest.open());
    expect(server.latest.received).toMatchObject([{ type: 'join', name: 'じろう' }]);
  });

  it('満員なら、満員の画面を出す', async () => {
    const { server } = await openPlayerPage();

    await joinAs('たろう');
    act(() => {
      server.latest.open();
      server.latest.closeFromServer(CLOSE_CODES.room_full);
    });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('この部屋は満員です');
    expect(screen.queryByLabelText('名前')).toBeNull();
  });

  it('切れたら「再接続中」を出す', async () => {
    const { server } = await openPlayerPage();

    await joinAs('たろう');
    act(() => {
      server.latest.open();
      server.latest.emit({ type: 'joined', participantId: ME, room: ROOM });
      server.latest.closeFromServer(1006);
    });

    expect(screen.getByRole('status')).toHaveTextContent('つなぎ直しています');
  });

  it('別のタブで開かれたら、そう出し、つなぎ直さない', async () => {
    const { server } = await openPlayerPage();

    await joinAs('たろう');
    act(() => {
      server.latest.open();
      server.latest.emit({ type: 'joined', participantId: ME, room: ROOM });
      server.latest.closeFromServer(CLOSE_CODES.replaced);
    });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('別のタブで開かれました');
    expect(server.sockets).toHaveLength(1);
  });
});

describe('画面の移動と接続', () => {
  it('部屋の画面を離れたら、接続を閉じる', async () => {
    const { server, router } = await openPlayerPage();

    await joinAs('たろう');
    act(() => server.latest.open());
    await act(() => router.navigate({ to: '/' }));

    expect(server.latest.readyState).toBe(WebSocket.CLOSED);
    expect(server.sockets).toHaveLength(1);
  });

  it.each(['room-1', 'A'.repeat(64), 'a'.repeat(63)])(
    '部屋 ID の形が違う /r/%s は「ページが見つかりません」を出し、接続を開かない',
    async (roomId) => {
      saveToken(roomId, createToken());
      const { server } = await openPlayerPage(`/r/${roomId}`);

      expect(await screen.findByRole('heading', { level: 1, name: 'ページが見つかりません' })).toBeInTheDocument();
      expect(server.sockets).toHaveLength(0);
    },
  );
});
