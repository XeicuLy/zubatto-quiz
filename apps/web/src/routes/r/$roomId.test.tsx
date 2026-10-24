import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CLOSE_CODES, type FinalRanking } from '@zubatto-quiz/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeRoomServer } from '../../../test/fake-room-server';
import { recordSounds } from '../../../test/fake-sound';
import { liveRegion } from '../../../test/live-region';
import { createToken, loadToken, saveToken } from '../../features/player/token-storage';
import { createAppRouter } from '../../router';

const ROOM_ID = 'a'.repeat(64);
const ROOM = { title: 'テスト', questionCount: 3, phase: 'lobby', questionIndex: null } as const;
const ME = '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e61';
const OTHER = '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e62';

async function openPlayerPage(path = `/r/${ROOM_ID}`, sound = recordSounds()) {
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

  it('部屋がなければ、秘密を消して「部屋が見つかりません」を出す', async () => {
    const { server } = await openPlayerPage();

    await joinAs('たろう');
    act(() => {
      server.latest.open();
      server.latest.closeFromServer(CLOSE_CODES.room_not_found);
    });

    expect(loadToken(ROOM_ID)).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('部屋が見つかりません');
    expect(screen.queryByLabelText('名前')).toBeNull();
    expect(server.sockets).toHaveLength(1);
  });

  it('切れたら「再接続中」を出す', async () => {
    const { server } = await openPlayerPage();

    await joinAs('たろう');
    act(() => {
      server.latest.open();
      server.latest.emit({ type: 'joined', participantId: ME, room: ROOM });
      server.latest.closeFromServer(1006);
    });

    expect(screen.getByText('接続が切れました。つなぎ直しています', { selector: 'p' })).toBeInTheDocument();
    // 読み上げ領域は __root に常にあり、文だけが入る
    await waitFor(() => expect(liveRegion('polite')).toHaveTextContent('接続が切れました。つなぎ直しています'));
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

describe('出題と回答（F8・F10・F17）', () => {
  it('出題で問題文を出し、受付が始まったら選択肢を押して、回答を1回だけ送る', async () => {
    const { server } = await openPlayerPage();
    await joinAs('たろう');
    act(() => {
      server.latest.open();
      server.latest.emit({ type: 'joined', participantId: ME, room: ROOM });
      server.latest.emit({
        type: 'questionShown',
        questionId: 'q-1',
        questionIndex: 0,
        questionCount: 3,
        text: '今年の社内ランチで一番人気の店は？',
        limitMs: 10_000,
      });
    });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('今年の社内ランチで一番人気の店は？');
    // 選択肢のボタン（番号 + 選択肢の名前）は、受付が始まるまで出ない
    expect(screen.queryAllByRole('button', { name: /^\d/ })).toEqual([]);

    act(() =>
      server.latest.emit({
        type: 'answeringStarted',
        questionId: 'q-1',
        choices: ['ラーメン', 'カレー'],
        limitMs: 10_000,
        remainingMs: 10_000,
      }),
    );
    // 選択肢を描くフレームで計測が始まる
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const curry = screen.getByRole('button', { name: /カレー/ });
    fireEvent.click(curry);
    fireEvent.click(curry);

    const answers = server.latest.received.filter((message) => message.type === 'answer');
    expect(answers).toEqual([{ type: 'answer', questionId: 'q-1', choiceIndex: 1, elapsedMs: expect.any(Number) }]);
    expect(screen.getByText('締切を待っています')).toBeInTheDocument();
  });
});

describe('結果とランキング（F14・F15）', () => {
  it('締切のあとは結果と自分の位置を出し、② で最速正解、③ で途中経過、最後に最終ランキングを出す', async () => {
    const { server } = await openPlayerPage();
    await joinAs('たろう');
    act(() => {
      server.latest.open();
      server.latest.emit({ type: 'joined', participantId: ME, room: ROOM });
      server.latest.emit({
        type: 'questionShown',
        questionId: 'q-1',
        questionIndex: 0,
        questionCount: 3,
        text: '今年の社内ランチで一番人気の店は？',
        limitMs: 10_000,
      });
      server.latest.emit({
        type: 'answeringStarted',
        questionId: 'q-1',
        choices: ['ラーメン', 'カレー'],
        limitMs: 10_000,
        remainingMs: 10_000,
      });
    });

    // ① 正解と自分の位置
    act(() =>
      server.latest.emit({
        type: 'myResult',
        questionId: 'q-1',
        correctIndex: 1,
        answer: { choiceIndex: 1, elapsedMs: 2370 },
        correct: true,
        points: 882,
        bonusPoints: 0,
        totalScore: 882,
        remainingMaxPoints: 2400,
        position: { kind: 'chasing', rankUp: 0, gapToAbove: 30, gapToTop: 93 },
      }),
    );
    expect(screen.getByRole('region', { name: 'この問題の結果' })).toHaveTextContent('○ 正解');
    expect(screen.getByRole('region', { name: 'あなたの位置' })).toHaveTextContent('残り2問で、最大 2,400点 取れます');
    expect(screen.queryByRole('region', { name: '最速正解' })).toBeNull();

    // ② 最速正解は、① の結果の下に出る
    act(() =>
      server.latest.emit({
        type: 'fastest',
        questionId: 'q-1',
        correctIndex: 1,
        fastest: [{ participantId: OTHER, name: 'はなこ', elapsedMs: 840 }],
        correctCount: 2,
        answeredCount: 2,
        ranksHidden: false,
        biggestClimber: null,
      }),
    );
    expect(screen.getByRole('region', { name: '最速正解' })).toHaveTextContent('はなこ0.84秒');
    expect(screen.getByRole('region', { name: 'この問題の結果' })).toBeInTheDocument();

    // ③ 途中経過では、自分の行を強調する
    act(() =>
      server.latest.emit({
        type: 'standings',
        questionId: 'q-1',
        questionIndex: 0,
        participantCount: 2,
        entries: [
          { participantId: OTHER, name: 'はなこ', rank: 1, totalScore: 975, points: 975 },
          { participantId: ME, name: 'たろう', rank: 2, totalScore: 882, points: 882 },
        ],
      }),
    );
    const table = screen.getByRole('table', { name: '途中経過' });
    expect(screen.getByText('あなた').closest('tr')).toHaveTextContent('2位たろう');
    expect(table).toHaveTextContent('はなこ');

    // 最終ランキング
    act(() =>
      server.latest.emit({
        type: 'finalRanking',
        questionCount: 3,
        entries: [
          { participantId: OTHER, name: 'はなこ', rank: 1, totalScore: 2900 },
          { participantId: ME, name: 'たろう', rank: 2, totalScore: 2700 },
        ],
      }),
    );
    expect(screen.getByRole('region', { name: '優勝' })).toHaveTextContent('はなこ');
    expect(screen.getByText('あなた').closest('li')).toHaveTextContent('2位たろう');
  });
});

describe('部屋が終わったとき（#97・F17）', () => {
  const FINAL_RANKING: FinalRanking = {
    type: 'finalRanking',
    questionCount: 3,
    entries: [
      { participantId: OTHER, name: 'はなこ', rank: 1, totalScore: 2900 },
      { participantId: ME, name: 'たろう', rank: 2, totalScore: 2700 },
    ],
  };

  it('最終ランキングのあとに終わったら、手元の最終ランキングを残したまま、終わったことを出す', async () => {
    const { server } = await openPlayerPage();
    await joinAs('たろう');
    act(() => {
      server.latest.open();
      server.latest.emit({ type: 'joined', participantId: ME, room: ROOM });
      server.latest.emit(FINAL_RANKING);
    });
    const winner = screen.getByRole('region', { name: '優勝' });

    act(() => server.latest.closeFromServer(CLOSE_CODES.room_ended));

    expect(screen.getByText('この部屋は終わりました', { selector: 'p' })).toBeInTheDocument();
    await waitFor(() => expect(liveRegion('assertive')).toHaveTextContent('この部屋は終わりました'));
    // 作り直さずに同じ要素を残す。作り直すと、優勝の出てくるアニメーションがもう一度流れる
    expect(winner).toBeInTheDocument();
    expect(winner).toHaveTextContent('はなこ');
    expect(screen.getByText('あなた').closest('li')).toHaveTextContent('2位たろう');
    expect(server.sockets).toHaveLength(1);
  });

  it('問題の途中で終わったら、途中で終えたことを出す', async () => {
    const { server } = await openPlayerPage();
    await joinAs('たろう');
    act(() => {
      server.latest.open();
      server.latest.emit({ type: 'joined', participantId: ME, room: ROOM });
      server.latest.emit({
        type: 'questionShown',
        questionId: 'q-1',
        questionIndex: 0,
        questionCount: 3,
        text: '今年の社内ランチで一番人気の店は？',
        limitMs: 10_000,
      });
    });

    act(() => server.latest.closeFromServer(CLOSE_CODES.room_ended));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('この部屋は終わりました');
    expect(screen.getByText(/ホストが部屋を途中で終えました/)).toBeInTheDocument();
    expect(screen.queryByText('今年の社内ランチで一番人気の店は？')).toBeNull();
  });

  it('終わったあとに読み込み直したら、どこで終わったかは言わずに、終わったことだけを出す', async () => {
    saveToken(ROOM_ID, createToken());
    const { server } = await openPlayerPage();

    // 部屋の DO は、終わった部屋への resume を resumed を送らずに閉じる
    act(() => {
      server.latest.open();
      server.latest.closeFromServer(CLOSE_CODES.room_ended);
    });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('この部屋は終わりました');
    expect(screen.getByText('遊んでくれてありがとうございました。')).toBeInTheDocument();
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

describe('効果音（F18）', () => {
  it('名前の入力には切り替えを出さず、入室したら出す。出題が届くと出題の音を鳴らす', async () => {
    const { server, sound } = await openPlayerPage();

    expect(screen.queryByRole('button', { name: '音を消す' })).toBeNull();
    await joinAs('たろう');
    act(() => {
      server.latest.open();
      server.latest.emit({ type: 'joined', participantId: ME, room: ROOM });
      server.latest.emit({
        type: 'questionShown',
        questionId: 'q-0',
        questionIndex: 0,
        questionCount: 3,
        text: '日本一高い山は？',
        limitMs: 10_000,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: '音を消す' }));

    expect(sound.cues).toEqual(['question']);
    expect(sound.muted).toEqual([true]);
  });
});
