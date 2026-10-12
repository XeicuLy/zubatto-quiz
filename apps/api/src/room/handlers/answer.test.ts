import type { ClientMessage, ServerMessage } from '@zubatto-quiz/protocol';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connect,
  joinPlayer,
  messageReader,
  newRoom,
  nextOf,
  type RoomStub,
  type Socket,
} from '../../../test/room-socket';

const LIMIT_MS = 10_000;

const send = (socket: Socket, message: ClientMessage | Record<string, unknown>) =>
  socket.ws.send(JSON.stringify(message));

/** 回答を送り、本人へ届く返事（answerAccepted か error）を待つ */
async function answer(socket: Socket, message: Omit<Extract<ClientMessage, { type: 'answer' }>, 'type'>) {
  send(socket, { type: 'answer', ...message });
  for (;;) {
    const reply = (await socket.next()) as ServerMessage;
    if (reply.type === 'answerAccepted' || reply.type === 'error') {
      return reply;
    }
  }
}

/** alice の部屋に、ホストと回答者を入れ、第1問の受付を始めたところまで進める */
async function startAccepting(stub: RoomStub, names = ['たろう']) {
  const hostWs = await connect(stub, { role: 'host', ownerId: 'alice' });
  const host = { ws: hostWs, next: messageReader(hostWs) };
  const players = [];
  for (const name of names) {
    players.push(await joinPlayer(stub, name));
  }
  send(host, { type: 'showQuestion', questionIndex: 0 });
  send(host, { type: 'startAnswering', questionIndex: 0 });
  await nextOf(host, 'answeringStarted');
  return { host, players };
}

type AnswerRow = { questionId: string; participantId: string; choiceIndex: number; elapsedMs: number };

const readAnswers = (stub: RoomStub) =>
  runInDurableObject(stub, (_instance, state) =>
    state.storage.sql
      .exec<AnswerRow>(
        `SELECT question_id AS questionId, participant_id AS participantId, choice_index AS choiceIndex, elapsed_ms AS elapsedMs
         FROM answers ORDER BY rowid`,
      )
      .toArray(),
  );

const q1 = { questionId: 'q-1', choiceIndex: 1, elapsedMs: 2_345 };

describe('回答の受け付け（F10）', () => {
  it('受け付けた回答を本人に返し、ホストに回答数を知らせる', async () => {
    const stub = await newRoom();
    const { host, players } = await startAccepting(stub, ['たろう', 'はなこ']);
    const [taro] = players;

    expect(await answer(taro, q1)).toEqual({
      type: 'answerAccepted',
      questionId: 'q-1',
      choiceIndex: 1,
      elapsedMs: 2_340,
    });
    expect(await nextOf(host, 'answerProgress')).toEqual({
      type: 'answerProgress',
      questionId: 'q-1',
      answeredCount: 1,
      participantCount: 2,
    });
    expect(await readAnswers(stub)).toEqual([
      { questionId: 'q-1', participantId: taro.participantId, choiceIndex: 1, elapsedMs: 2_340 },
    ]);
  });

  it('回答数は回答者へは送らない', async () => {
    const stub = await newRoom();
    const { players } = await startAccepting(stub, ['たろう', 'はなこ']);
    const [taro, hanako] = players;

    await answer(taro, q1);
    // はなこが自分の回答の返事を受け取るまでに、たろうの回答数が届いていないことを確かめる
    send(hanako, { type: 'answer', ...q1 });
    const received: unknown[] = [];
    for (;;) {
      const message = (await hanako.next()) as ServerMessage;
      received.push(message.type);
      if (message.type === 'answerAccepted') {
        break;
      }
    }
    expect(received).not.toContain('answerProgress');
  });

  it('ホストの接続からの回答は受け付けない', async () => {
    const stub = await newRoom();
    const { host } = await startAccepting(stub);

    expect(await answer(host, q1)).toEqual({ type: 'error', code: 'invalid_state' });
    expect(await readAnswers(stub)).toEqual([]);
  });
});

describe('なりすまし（S4・ADR 0004）', () => {
  it('他人の participantId を書いて送っても、送った接続の回答者として記録する', async () => {
    const stub = await newRoom();
    const { players } = await startAccepting(stub, ['たろう', 'はなこ']);
    const [taro, hanako] = players;

    send(taro, { type: 'answer', ...q1, participantId: hanako.participantId });
    expect(await nextOf(taro, 'answerAccepted')).toMatchObject({ questionId: 'q-1' });

    // はなこは、自分の回答をまだ送れる
    expect(await answer(hanako, { ...q1, choiceIndex: 0 })).toMatchObject({ type: 'answerAccepted' });
    expect((await readAnswers(stub)).map((row) => row.participantId)).toEqual([
      taro.participantId,
      hanako.participantId,
    ]);
  });
});

describe('二重回答（S4・F10）', () => {
  it('同じ問題への2回目は already_answered で断り、1回目の回答を残す', async () => {
    const stub = await newRoom();
    const {
      players: [taro],
    } = await startAccepting(stub);

    await answer(taro, q1);
    expect(await answer(taro, { ...q1, choiceIndex: 0, elapsedMs: 100 })).toEqual({
      type: 'error',
      code: 'already_answered',
    });
    expect(await readAnswers(stub)).toEqual([
      { questionId: 'q-1', participantId: taro.participantId, choiceIndex: 1, elapsedMs: 2_340 },
    ]);
  });

  it('休止から起きたあとも、2回目を断る', async () => {
    const stub = await newRoom();
    const {
      players: [taro],
    } = await startAccepting(stub);

    await answer(taro, q1);
    // ふつうの evict は端末の接続を残す。起きたあとの DO は、attachment から同じ回答者だと分かる
    await evictDurableObject(stub);
    expect(await answer(taro, { ...q1, choiceIndex: 0 })).toEqual({ type: 'error', code: 'already_answered' });
    expect(await readAnswers(stub)).toHaveLength(1);
  });
});

describe('受付中でない問題への回答（F10）', () => {
  it('受付を始める前は not_accepting で断る', async () => {
    const stub = await newRoom();
    const hostWs = await connect(stub, { role: 'host', ownerId: 'alice' });
    const host = { ws: hostWs, next: messageReader(hostWs) };
    const taro = await joinPlayer(stub, 'たろう');
    send(host, { type: 'showQuestion', questionIndex: 0 });
    await nextOf(taro, 'questionShown');

    expect(await answer(taro, q1)).toEqual({ type: 'error', code: 'not_accepting' });
    expect(await readAnswers(stub)).toEqual([]);
  });

  it('ホストが締め切ったあとは not_accepting で断る', async () => {
    const stub = await newRoom();
    const {
      host,
      players: [taro],
    } = await startAccepting(stub);
    send(host, { type: 'closeAnswering', questionIndex: 0 });
    await nextOf(host, 'revealed');

    expect(await answer(taro, q1)).toEqual({ type: 'error', code: 'not_accepting' });
    expect(await readAnswers(stub)).toEqual([]);
  });

  it('今の問題でない questionId には not_accepting を返す', async () => {
    const stub = await newRoom(undefined, 2);
    const {
      players: [taro],
    } = await startAccepting(stub);

    expect(await answer(taro, { ...q1, questionId: 'q-2' })).toEqual({ type: 'error', code: 'not_accepting' });
    expect(await readAnswers(stub)).toEqual([]);
  });

  describe('alarm が遅れたとき', () => {
    let now: number;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      now = Date.now();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('締切を過ぎていれば、alarm を待たずに締め切ってから断る', async () => {
      const stub = await newRoom();
      const {
        players: [taro],
      } = await startAccepting(stub);

      // alarm は動かさず、時計だけを締切まで進める
      vi.setSystemTime(now + LIMIT_MS);
      expect(await answer(taro, q1)).toEqual({ type: 'error', code: 'not_accepting' });
      expect(await readAnswers(stub)).toEqual([]);
    });

    it('締切の直前なら受け付ける', async () => {
      const stub = await newRoom();
      const {
        players: [taro],
      } = await startAccepting(stub);

      vi.setSystemTime(now + LIMIT_MS - 1);
      expect(await answer(taro, q1)).toMatchObject({ type: 'answerAccepted' });
    });
  });
});

describe('選択肢の範囲', () => {
  it('その問題の選択肢の数を超える choiceIndex は invalid_choice で断る', async () => {
    const stub = await newRoom();
    const {
      players: [taro],
    } = await startAccepting(stub);

    // testQuestion の選択肢は2つ。protocol は4択までの 0〜3 を通すので、2 と 3 は部屋の DO で断る
    expect(await answer(taro, { ...q1, choiceIndex: 2 })).toEqual({ type: 'error', code: 'invalid_choice' });
    expect(await readAnswers(stub)).toEqual([]);
    // 断られたあとは、正しい選択肢で答え直せる
    expect(await answer(taro, q1)).toMatchObject({ type: 'answerAccepted' });
  });
});

describe('経過時間（P2）', () => {
  // [端末が送った elapsedMs, 保存して返す elapsedMs]。制限時間は10秒
  it.each<[number, number]>([
    [2_345, 2_340],
    [10_000, 10_000],
    [0, 0],
    [10_001, 10_000],
    [20_000, 10_000],
  ])('%i ミリ秒は %i ミリ秒として受け付ける', async (sent, stored) => {
    const stub = await newRoom();
    const {
      players: [taro],
    } = await startAccepting(stub);

    expect(await answer(taro, { ...q1, elapsedMs: sent })).toMatchObject({ elapsedMs: stored });
    expect(await readAnswers(stub)).toMatchObject([{ elapsedMs: stored }]);
  });

  it('負の値は protocol の検査で invalid_message になる', async () => {
    const stub = await newRoom();
    const {
      players: [taro],
    } = await startAccepting(stub);

    expect(await answer(taro, { ...q1, elapsedMs: -1 })).toEqual({ type: 'error', code: 'invalid_message' });
  });
});

describe('50名の一斉回答（P3）', () => {
  it('締切の直前に50名が同時に答えても、50件とも受け付ける', async () => {
    const stub = await newRoom();
    const names = Array.from({ length: 50 }, (_, i) => `回答者${i + 1}`);
    const { host, players } = await startAccepting(stub, names);

    const replies = await Promise.all(players.map((player, i) => answer(player, { ...q1, elapsedMs: 9_000 + i })));

    expect(replies.every((reply) => reply.type === 'answerAccepted')).toBe(true);
    expect(await readAnswers(stub)).toHaveLength(50);
    // ホストへは1件ごとに数が届き、最後は50になる
    const counts = [];
    for (let i = 0; i < 50; i++) {
      counts.push((await nextOf(host, 'answerProgress')).answeredCount);
    }
    expect(counts).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });
});
