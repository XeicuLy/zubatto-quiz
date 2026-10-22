import type { ClientMessage, ServerMessage } from '@zubatto-quiz/protocol';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connect,
  joinPlayer,
  messageReader,
  newRoom,
  newToken,
  nextOf,
  resumePlayer,
  type RoomStub,
  type Socket,
} from '../../../test/room-socket';

const LIMIT_MS = 10_000;

const send = (socket: Socket, message: ClientMessage) => socket.ws.send(JSON.stringify(message));

type Player = Awaited<ReturnType<typeof joinPlayer>>;

/** alice の部屋に、ホストと回答者（入室した順）を入れる */
async function enterRoom(stub: RoomStub, names: readonly string[]) {
  const hostWs = await connect(stub, { role: 'host', ownerId: 'alice' });
  const host = { ws: hostWs, next: messageReader(hostWs) };
  const players: Player[] = [];
  for (const name of names) {
    players.push(await joinPlayer(stub, name));
  }
  return { host, players };
}

/**
 * 第 questionIndex 問（0始まり）を出して受付を始め、回答者に答えさせて、ホストが締め切る。
 * answers は players と同じ並びで、答えない人は null。newRoom の問題の正解は、どれも0番目
 */
async function playQuestion(
  host: Socket,
  players: readonly Player[],
  questionIndex: number,
  answers: readonly ({ choiceIndex: number; elapsedMs: number } | null)[],
) {
  send(host, { type: 'showQuestion', questionIndex });
  send(host, { type: 'startAnswering', questionIndex });
  for (const [i, player] of players.entries()) {
    await nextOf(player, 'answeringStarted');
    const answer = answers[i];
    if (answer) {
      send(player, { type: 'answer', questionId: `q-${questionIndex + 1}`, ...answer });
      await nextOf(player, 'answerAccepted');
    }
  }
  send(host, { type: 'closeAnswering', questionIndex });
}

const correct = (elapsedMs: number) => ({ choiceIndex: 0, elapsedMs });
const wrong = (elapsedMs: number) => ({ choiceIndex: 1, elapsedMs });

/** ② まで進めて、全員に fastest が届くのを待つ */
async function revealFastest(host: Socket, players: readonly Player[], questionIndex: number) {
  send(host, { type: 'revealFastest', questionIndex });
  const [forHost, ...forPlayers] = await Promise.all([host, ...players].map((socket) => nextOf(socket, 'fastest')));
  return { forHost, forPlayers };
}

const readScores = (stub: RoomStub) =>
  runInDurableObject(stub, (_instance, state) =>
    state.storage.sql
      .exec<{ questionId: string; points: number }>(
        'SELECT question_id AS questionId, points FROM question_scores ORDER BY points DESC',
      )
      .toArray(),
  );

describe('締切のあとの結果（F11・F13・F14・F15）', () => {
  it('① で、ホストには正解と選択肢ごとの人数、回答者には1人ずつ自分の正誤と得点・位置が届く', async () => {
    const stub = await newRoom('alice', 3);
    const { host, players } = await enterRoom(stub, ['たろう', 'はなこ', 'じろう']);
    const [taro, hanako, jiro] = players;

    await playQuestion(host, players, 0, [correct(1230), correct(500), wrong(300)]);

    expect(await nextOf(host, 'revealed')).toEqual({
      type: 'revealed',
      questionId: 'q-1',
      correctIndex: 0,
      choiceCounts: [2, 1],
      answeredCount: 3,
      participantCount: 3,
    });
    // 10秒のうち 1.23秒は 938点、0.50秒は 975点（要件定義書「1問の得点の例」と同じ式）
    expect(await nextOf(hanako, 'myResult')).toEqual({
      type: 'myResult',
      questionId: 'q-1',
      correctIndex: 0,
      answer: { choiceIndex: 0, elapsedMs: 500 },
      correct: true,
      points: 975,
      totalScore: 975,
      remainingMaxPoints: 2000,
      position: { kind: 'leader', rankUp: 0, leadOverNext: 37 },
    });
    expect(await nextOf(taro, 'myResult')).toMatchObject({
      correct: true,
      points: 938,
      position: { kind: 'podium', rank: 2, gapToAbove: 37 },
    });
    expect(await nextOf(jiro, 'myResult')).toMatchObject({
      answer: { choiceIndex: 1, elapsedMs: 300 },
      correct: false,
      points: 0,
      position: { kind: 'podium', rank: 3, gapToAbove: 938 },
    });
  });

  it('② で、最速正解者の名前と秒数・正解した人数が全員に届く', async () => {
    const stub = await newRoom('alice', 3);
    const { host, players } = await enterRoom(stub, ['たろう', 'はなこ', 'じろう']);
    const [taro, hanako] = players;
    await playQuestion(host, players, 0, [correct(1230), correct(500), wrong(300)]);

    const { forHost, forPlayers } = await revealFastest(host, players, 0);

    const expected = {
      type: 'fastest',
      questionId: 'q-1',
      correctIndex: 0,
      fastest: [
        { participantId: hanako.participantId, name: 'はなこ', elapsedMs: 500 },
        { participantId: taro.participantId, name: 'たろう', elapsedMs: 1230 },
      ],
      correctCount: 2,
      answeredCount: 3,
      ranksHidden: false,
      // 第1問は順位の変化がない
      biggestClimber: null,
    };
    expect(forHost).toEqual(expected);
    expect(forPlayers).toEqual([expected, expected, expected]);
  });

  it('② の「一番順位を上げた人」は、前の問題からの上げ幅で決まる', async () => {
    const stub = await newRoom('alice', 4);
    const { host, players } = await enterRoom(stub, ['たろう', 'はなこ', 'じろう']);
    const [, , jiro] = players;
    // 第1問: たろう 1位・はなこ 2位・じろう 3位
    await playQuestion(host, players, 0, [correct(500), correct(1000), null]);
    await revealFastest(host, players, 0);

    // 第2問: じろうだけ速く正解して1位へ
    await playQuestion(host, players, 1, [null, null, correct(100)]);
    const { forHost } = await revealFastest(host, players, 1);

    expect(forHost).toMatchObject({
      ranksHidden: false,
      biggestClimber: { participantId: jiro.participantId, name: 'じろう', rankUp: 2 },
    });
  });

  it('③ で、上位の途中経過が全員に届く', async () => {
    const stub = await newRoom('alice', 3);
    const { host, players } = await enterRoom(stub, ['たろう', 'はなこ']);
    const [taro, hanako] = players;
    await playQuestion(host, players, 0, [correct(1230), correct(500)]);
    await revealFastest(host, players, 0);

    send(host, { type: 'showStandings', questionIndex: 0 });
    const received = await Promise.all([host, ...players].map((socket) => nextOf(socket, 'standings')));

    const expected = {
      type: 'standings',
      questionId: 'q-1',
      questionIndex: 0,
      participantCount: 2,
      entries: [
        { participantId: hanako.participantId, name: 'はなこ', rank: 1, totalScore: 975, points: 975 },
        { participantId: taro.participantId, name: 'たろう', rank: 2, totalScore: 938, points: 938 },
      ],
    };
    expect(received).toEqual([expected, expected, expected]);
  });

  it('最後の問題の ② のあと、最終ランキングが全員に届く', async () => {
    const stub = await newRoom('alice', 1);
    const { host, players } = await enterRoom(stub, ['たろう', 'はなこ']);
    const [taro, hanako] = players;
    await playQuestion(host, players, 0, [wrong(1230), correct(500)]);
    await revealFastest(host, players, 0);

    send(host, { type: 'showFinalRanking' });
    const received = await Promise.all([host, ...players].map((socket) => nextOf(socket, 'finalRanking')));

    const expected = {
      type: 'finalRanking',
      questionCount: 1,
      entries: [
        { participantId: hanako.participantId, name: 'はなこ', rank: 1, totalScore: 975 },
        { participantId: taro.participantId, name: 'たろう', rank: 2, totalScore: 0 },
      ],
    };
    expect(received).toEqual([expected, expected, expected]);
  });

  it('全員が不正解なら、最速正解者は空で、正解した人数は0（F14）', async () => {
    const stub = await newRoom('alice', 3);
    const { host, players } = await enterRoom(stub, ['たろう', 'はなこ']);
    await playQuestion(host, players, 0, [wrong(1230), wrong(500)]);

    const { forHost } = await revealFastest(host, players, 0);

    expect(forHost).toMatchObject({ fastest: [], correctCount: 0, answeredCount: 2 });
  });
});

describe('自分の位置の出し分け（F15）', () => {
  it('1〜3位には順位が、4位以下には順位の数字を持たない差だけが届く', async () => {
    const stub = await newRoom('alice', 3);
    const names = ['いち', 'に', 'さん', 'よん', 'ご'];
    const { host, players } = await enterRoom(stub, names);
    await playQuestion(host, players, 0, [correct(100), correct(200), correct(300), correct(400), correct(500)]);

    const positions = await Promise.all(players.map(async (player) => (await nextOf(player, 'myResult')).position));

    // 10秒のうち 0.10秒は 995点、0.10秒ずつ遅いと5点ずつ低い
    expect(positions).toEqual([
      { kind: 'leader', rankUp: 0, leadOverNext: 5 },
      { kind: 'podium', rank: 2, rankUp: 0, gapToAbove: 5 },
      { kind: 'podium', rank: 3, rankUp: 0, gapToAbove: 5 },
      { kind: 'chasing', rankUp: 0, gapToAbove: 5, gapToTop: 15 },
      { kind: 'chasing', rankUp: 0, gapToAbove: 5, gapToTop: 20 },
    ]);
  });
});

describe('最後の2問（F15）', () => {
  it('3問の部屋の第2問では、自分の位置と一番順位を上げた人を伏せる', async () => {
    const stub = await newRoom('alice', 3);
    const { host, players } = await enterRoom(stub, ['たろう', 'はなこ']);
    await playQuestion(host, players, 0, [correct(500), correct(1000)]);
    await revealFastest(host, players, 0);

    await playQuestion(host, players, 1, [null, correct(100)]);

    for (const player of players) {
      expect((await nextOf(player, 'myResult')).position).toEqual({ kind: 'hidden' });
    }
    const { forHost } = await revealFastest(host, players, 1);
    expect(forHost.ranksHidden).toBe(true);
    expect(forHost).not.toHaveProperty('biggestClimber');
  });

  it('2問以下の部屋では、第1問から伏せる', async () => {
    const stub = await newRoom('alice', 2);
    const { host, players } = await enterRoom(stub, ['たろう']);
    const [taro] = players;
    await playQuestion(host, players, 0, [correct(500)]);

    expect((await nextOf(taro, 'myResult')).position).toEqual({ kind: 'hidden' });
    expect((await revealFastest(host, players, 0)).forHost.ranksHidden).toBe(true);
  });
});

describe('正解を配る時期（S2・ADR 0002）', () => {
  it('締切の前に回答者へ届くメッセージには正解が含まれず、締切の myResult で初めて届く', async () => {
    const stub = await newRoom('alice', 3);
    const { host, players } = await enterRoom(stub, ['たろう']);
    const [taro] = players;
    const received: unknown[] = [];
    taro.ws.addEventListener('message', ({ data }) => {
      received.push(JSON.parse(String(data)));
    });

    await playQuestion(host, players, 0, [correct(500)]);
    await nextOf(taro, 'myResult');

    const firstWithCorrect = received.findIndex((message) => JSON.stringify(message).includes('correct'));
    expect(received[firstWithCorrect]).toMatchObject({ type: 'myResult' });
    expect(firstWithCorrect).toBe(received.length - 1);
  });

  it('ホストにも、正解と回答の分布は締切の前に届かず、締切の revealed で初めて届く（F13）', async () => {
    const stub = await newRoom('alice', 3);
    const { host, players } = await enterRoom(stub, ['たろう', 'はなこ']);
    const received: unknown[] = [];
    host.ws.addEventListener('message', ({ data }) => {
      received.push(JSON.parse(String(data)));
    });

    // 受付中に届く回答の人数（answerProgress）から、選択肢ごとの人数や正解が読めないこと
    await playQuestion(host, players, 0, [correct(500), wrong(700)]);
    await nextOf(host, 'revealed');

    const firstWithResult = received.findIndex((message) => /correctIndex|choiceCounts/.test(JSON.stringify(message)));
    expect(received[firstWithResult]).toMatchObject({ type: 'revealed', choiceCounts: [1, 1] });
    expect(firstWithResult).toBe(received.length - 1);
  });
});

describe('得点の保存（A3）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('時間切れの alarm で締め切っても、ホストの締切と同じく得点を保存して結果を配る', async () => {
    const stub = await newRoom('alice', 3);
    const { host, players } = await enterRoom(stub, ['たろう']);
    const [taro] = players;
    send(host, { type: 'showQuestion', questionIndex: 0 });
    send(host, { type: 'startAnswering', questionIndex: 0 });
    await nextOf(taro, 'answeringStarted');
    send(taro, { type: 'answer', questionId: 'q-1', ...correct(500) });
    await nextOf(taro, 'answerAccepted');

    vi.setSystemTime(Date.now() + LIMIT_MS);
    await runDurableObjectAlarm(stub);

    expect(await nextOf(taro, 'myResult')).toMatchObject({ points: 975 });
    expect(await readScores(stub)).toEqual([{ questionId: 'q-1', points: 975 }]);
  });

  it('締切まで終えた問題の得点は、休止のあとも残り、resume の得点と ② に使われる', async () => {
    const stub = await newRoom('alice', 3);
    const { host, players } = await enterRoom(stub, ['たろう']);
    const token = newToken();
    const hanako = await joinPlayer(stub, 'はなこ', token);
    await playQuestion(host, [...players, hanako], 0, [wrong(300), correct(500)]);
    await nextOf(hanako, 'myResult');

    await evictDurableObject(stub);
    // 締め切ったあとに alarm が遅れて動いても、集計し直さない
    vi.setSystemTime(Date.now() + LIMIT_MS);
    await runDurableObjectAlarm(stub);

    expect(await readScores(stub)).toEqual([
      { questionId: 'q-1', points: 975 },
      { questionId: 'q-1', points: 0 },
    ]);
    const resumed = await resumePlayer(stub, token);
    expect(await nextOf(resumed, 'resumed')).toMatchObject({ score: 975 });

    const hostWs = await connect(stub, { role: 'host', ownerId: 'alice' });
    const newHost = { ws: hostWs, next: messageReader(hostWs) };
    send(newHost, { type: 'revealFastest', questionIndex: 0 });
    expect(await nextOf(newHost, 'fastest')).toMatchObject({
      fastest: [{ participantId: hanako.participantId, name: 'はなこ', elapsedMs: 500 }],
      correctCount: 1,
    });
  });
});

describe('締切から結果までの時間（P4）', () => {
  it('50名が答えた問題を締め切ると、全員に結果が2秒よりも十分に短い時間で届く', async () => {
    const stub = await newRoom('alice', 3);
    const names = Array.from({ length: 50 }, (_, i) => `回答者${i + 1}`);
    const { host, players } = await enterRoom(stub, names);
    send(host, { type: 'showQuestion', questionIndex: 0 });
    send(host, { type: 'startAnswering', questionIndex: 0 });
    await Promise.all(
      players.map(async (player, i) => {
        await nextOf(player, 'answeringStarted');
        send(player, { type: 'answer', questionId: 'q-1', choiceIndex: i % 2, elapsedMs: 100 * i });
        await nextOf(player, 'answerAccepted');
      }),
    );

    const startedAt = performance.now();
    send(host, { type: 'closeAnswering', questionIndex: 0 });
    const results: ServerMessage[] = await Promise.all([
      nextOf(host, 'revealed'),
      ...players.map((player) => nextOf(player, 'myResult')),
    ]);
    const elapsed = performance.now() - startedAt;

    expect(results).toHaveLength(51);
    // P4 の2秒の半分。テストの環境の揺れを見込んでも、集計と配信が間に合っていることを確かめる
    expect(elapsed).toBeLessThan(1_000);
  });
});
