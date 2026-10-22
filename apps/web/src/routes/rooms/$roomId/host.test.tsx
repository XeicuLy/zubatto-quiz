import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CLOSE_CODES } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { stubFakeApi } from '../../../../test/fake-api';
import { FakeRoomServer } from '../../../../test/fake-room-server';
import { recordSounds } from '../../../../test/fake-sound';
import { createAppRouter } from '../../../router';

const ROOM_ID = 'a'.repeat(64);
const ROOM = { title: '内輪クイズ', questionCount: 10, phase: 'lobby', questionIndex: null } as const;
const TARO = { participantId: '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e61', name: 'たろう' };

async function openHostPage(path = `/rooms/${ROOM_ID}/host`, sound = recordSounds()) {
  const server = new FakeRoomServer();
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    createRoomSocket: server.createSocket,
    sound,
  });
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  return { server, router, sound };
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

  it('ない部屋・他人の部屋なら「部屋が見つかりません」を出し、つなぎ直さない（S1）', async () => {
    stubFakeApi();
    const { server } = await openHostPage();

    // 部屋の DO は hostReady を送らずに閉じる
    act(() => {
      server.latest.open();
      server.latest.closeFromServer(CLOSE_CODES.room_not_found);
    });

    // 閉じた画面は、connectRoom がつなぎ直さずに止まった（closed）ときだけ出る。1006 なら「つなぎ直しています」になる
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('部屋が見つかりません');
    expect(screen.getByRole('link', { name: '問題セットの一覧に戻る' })).toHaveAttribute('href', '/admin');
    expect(server.sockets).toHaveLength(1);
  });

  it('画面を離れたら接続を閉じる', async () => {
    stubFakeApi();
    const { server, router } = await openHostPage();
    acceptHost(server);

    await act(() => router.navigate({ to: '/admin' }));

    expect(server.latest.readyState).toBe(WebSocket.CLOSED);
  });
});

describe('ホストの進行画面（T32）', () => {
  const ROOM_3 = { title: '内輪クイズ', questionCount: 3, phase: 'lobby', questionIndex: null } as const;
  const HANAKO = { participantId: '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e62', name: 'はなこ' };

  async function openStartedRoom() {
    stubFakeApi();
    const { server } = await openHostPage();
    act(() => {
      server.latest.open();
      server.latest.emit({ type: 'hostReady', room: ROOM_3 });
      server.latest.emit({ type: 'participants', participants: [TARO, HANAKO] });
    });
    return server;
  }

  const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

  it('出題と受付開始を別々に送り、締切のあとを ①・②・③ の順に1段ずつ進める（F8・F14・F15）', async () => {
    const server = await openStartedRoom();
    const socket = server.latest;

    press('第1問を出す');
    act(() =>
      socket.emit({
        type: 'questionShown',
        questionId: 'q-1',
        questionIndex: 0,
        questionCount: 3,
        text: '部長の好きな食べ物は？',
        limitMs: 10_000,
      }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('部長の好きな食べ物は？');
    expect(screen.queryByRole('list', { name: '選択肢' })).not.toBeInTheDocument();

    press('受付を始める');
    act(() =>
      socket.emit({
        type: 'answeringStarted',
        questionId: 'q-1',
        choices: ['カレー', 'ラーメン'],
        limitMs: 10_000,
        remainingMs: 10_000,
      }),
    );
    expect(screen.getByRole('list', { name: '選択肢' })).toHaveTextContent('カレー');

    press('いま締め切る');
    act(() =>
      socket.emit({
        type: 'revealed',
        questionId: 'q-1',
        correctIndex: 1,
        choiceCounts: [1, 1],
        answeredCount: 2,
        participantCount: 2,
      }),
    );
    expect(screen.getByRole('list', { name: '回答の分布' })).toHaveTextContent('○ 正解');
    // ① からは ② にしか進めない
    expect(screen.queryByRole('button', { name: '第2問を出す' })).not.toBeInTheDocument();

    press('最速正解を発表する');
    act(() =>
      socket.emit({
        type: 'fastest',
        questionId: 'q-1',
        correctIndex: 1,
        fastest: [{ participantId: HANAKO.participantId, name: 'はなこ', elapsedMs: 1_020 }],
        correctCount: 1,
        answeredCount: 2,
        ranksHidden: true,
      }),
    );
    expect(screen.getByRole('region', { name: '最速正解の発表' })).toHaveTextContent('はなこ');
    // 3問の部屋の第1問は最後の2問ではないので、③ を出せる
    press('途中経過を出す');
    act(() =>
      socket.emit({
        type: 'standings',
        questionId: 'q-1',
        questionIndex: 0,
        participantCount: 2,
        entries: [
          { ...HANAKO, rank: 1, totalScore: 980, points: 980 },
          { ...TARO, rank: 2, totalScore: 0, points: 0 },
        ],
      }),
    );
    expect(screen.getByRole('table', { name: '途中経過' })).toHaveTextContent('はなこ');
    expect(screen.getByRole('button', { name: '第2問を出す' })).toBeInTheDocument();

    expect(socket.received).toEqual([
      { type: 'showQuestion', questionIndex: 0 },
      { type: 'startAnswering', questionIndex: 0 },
      { type: 'closeAnswering', questionIndex: 0 },
      { type: 'revealFastest', questionIndex: 0 },
      { type: 'showStandings', questionIndex: 0 },
    ]);
  });

  it('締切の前の問題を、確かめてからやり直す（A3）', async () => {
    const server = await openStartedRoom();
    act(() => {
      server.latest.emit({
        type: 'questionShown',
        questionId: 'q-1',
        questionIndex: 0,
        questionCount: 3,
        text: '部長の好きな食べ物は？',
        limitMs: 10_000,
      });
    });

    press('この問題をやり直す');
    press('やり直す');

    expect(server.latest.received).toEqual([{ type: 'retryQuestion', questionIndex: 0 }]);
  });

  it('つなぎ直しているあいだは、進行の操作を押せない（A1）', async () => {
    const server = await openStartedRoom();

    act(() => server.latest.closeFromServer(1006));

    expect(screen.getByRole('button', { name: '第1問を出す', hidden: true }).closest('[inert]')).not.toBeNull();
  });

  it('最終ランキングのあとに部屋を終えたら、最終ランキングを映したまま、操作の代わりに終わったことと一覧への道を出す（#97）', async () => {
    const server = await openStartedRoom();
    act(() =>
      server.latest.emit({
        type: 'finalRanking',
        questionCount: 3,
        entries: [
          { ...HANAKO, rank: 1, totalScore: 2900 },
          { ...TARO, rank: 2, totalScore: 2700 },
        ],
      }),
    );

    const winner = screen.getByRole('region', { name: '優勝' });

    act(() => server.latest.closeFromServer(CLOSE_CODES.room_ended));

    // 作り直さずに同じ要素を残す。作り直すと、投影している優勝のアニメーションがもう一度流れる
    expect(winner).toBeInTheDocument();
    expect(winner).toHaveTextContent('はなこ');
    expect(screen.getByRole('status')).toHaveTextContent('この部屋は終わりました');
    expect(screen.getByRole('link', { name: '問題セットの一覧に戻る' })).toHaveAttribute('href', '/admin');
    // 接続は閉じたので、どの操作も送れない。押せないボタンは並べない
    expect(screen.queryByRole('button', { hidden: true })).toBeNull();
  });

  it('問題の途中で部屋を終えたら、映していた問題の代わりに終わったことを出す（#97）', async () => {
    const server = await openStartedRoom();
    act(() =>
      server.latest.emit({
        type: 'questionShown',
        questionId: 'q-1',
        questionIndex: 0,
        questionCount: 3,
        text: '部長の好きな食べ物は？',
        limitMs: 10_000,
      }),
    );

    act(() => server.latest.closeFromServer(CLOSE_CODES.room_ended));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('この部屋は終わりました');
    expect(screen.queryByText('部長の好きな食べ物は？')).toBeNull();
    expect(screen.getByRole('link', { name: '問題セットの一覧に戻る' })).toHaveAttribute('href', '/admin');
  });
});

describe('効果音（F18）', () => {
  it('出題が届くと出題の音を鳴らし、進行の帯から音を消せる', async () => {
    stubFakeApi();
    const { server, sound } = await openHostPage();
    acceptHost(server);

    act(() =>
      server.latest.emit({
        type: 'questionShown',
        questionId: 'q-0',
        questionIndex: 0,
        questionCount: 10,
        text: '日本一高い山は？',
        limitMs: 10_000,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '音を消す' }));

    expect(sound.cues).toEqual(['question']);
    expect(sound.muted).toEqual([true]);
  });
});
