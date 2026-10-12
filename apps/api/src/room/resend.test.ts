import { CLOSE_CODES, type ClientMessage, type RoomPhase, type ServerMessage } from '@zubatto-quiz/protocol';
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  closeOf,
  connect,
  connectHost,
  drain,
  exchange,
  joinPlayer,
  messageReader,
  newRoom,
  newToken,
  resumePlayer,
  type RoomStub,
  type Socket,
} from '../../test/room-socket';

const LIMIT_MS = 10_000;
const lobby = { title: 'テストの部屋', questionCount: 1, phase: 'lobby', questionIndex: null };

/** alice の部屋のホスト用の入口につなぎ、届いたメッセージを読めるようにする。hostReady もこちらで読む */
async function openHost(stub: RoomStub) {
  const ws = await connect(stub, { role: 'host', ownerId: 'alice' });
  return { ws, next: messageReader(ws), closed: closeOf(ws) };
}

/** つないだときに届いたメッセージを、最初の1通（joined・resumed・hostReady）から順にすべて読む */
async function greeting(socket: Socket): Promise<ServerMessage[]> {
  // 最初の1通が届けば、確かめ直しが済み、そのあとの送り直しも同じ処理の中で送られている
  const first = (await socket.next()) as ServerMessage;
  return [first, ...(await drain(socket))];
}

const typesOf = (messages: ServerMessage[]) => messages.map(({ type }) => type);

/** 第1問を、その段階まで進める操作。③ は問題が3問以上ないと出せないので、③ だけ3問の部屋にする */
const at = (index: number) => ({ questionIndex: index });
const toFastest: ClientMessage[] = [
  { type: 'showQuestion', ...at(0) },
  { type: 'startAnswering', ...at(0) },
  { type: 'closeAnswering', ...at(0) },
  { type: 'revealFastest', ...at(0) },
];
const steps: Record<RoomPhase, { questionCount: number; commands: ClientMessage[] }> = {
  lobby: { questionCount: 1, commands: [] },
  question: { questionCount: 1, commands: toFastest.slice(0, 1) },
  accepting: { questionCount: 1, commands: toFastest.slice(0, 2) },
  revealed: { questionCount: 1, commands: toFastest.slice(0, 3) },
  fastest: { questionCount: 1, commands: toFastest },
  standings: { questionCount: 3, commands: [...toFastest, { type: 'showStandings', ...at(0) }] },
  final: { questionCount: 1, commands: [...toFastest, { type: 'showFinalRanking' }] },
};

/** 部屋を作り、たろうを入室させてから、指定の段階まで進める */
async function roomAt(phase: RoomPhase) {
  const { questionCount, commands } = steps[phase];
  const stub = await newRoom('alice', questionCount);
  const host = await connectHost(stub);
  const token = newToken();
  const taro = await joinPlayer(stub, 'たろう', token);
  for (const command of commands) {
    await exchange(host, command);
  }
  return { stub, host, taro, token };
}

describe('ホスト用の接続の受け付け（ADR 0003）', () => {
  it('部屋の持ち主がつなぐと、hostReady と参加者一覧が届く', async () => {
    const stub = await newRoom();
    const { participantId } = await joinPlayer(stub, 'たろう');

    const host = await openHost(stub);

    expect(await host.next()).toEqual({ type: 'hostReady', room: lobby });
    expect(await host.next()).toEqual({ type: 'participants', participants: [{ participantId, name: 'たろう' }] });
  });

  it('終わった部屋につなぐと、hostReady は届かず 4410 room_ended で閉じる', async () => {
    const stub = await newRoom();
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('UPDATE room SET ended_at = ?', Date.now());
    });

    const host = await openHost(stub);

    expect(await host.closed).toEqual({ code: CLOSE_CODES.room_ended, reason: 'room_ended' });
  });
});

describe('今の段階のメッセージの送り直し（A1・F19）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // 締切のあとは、その問題の流れを頭から送る。端末は questionShown で問題を作り直してから、続きを受け取れる
  const flow = [
    ['lobby', [], []],
    ['question', ['questionShown'], ['questionShown']],
    ['accepting', ['questionShown', 'answeringStarted'], ['questionShown', 'answeringStarted', 'answerProgress']],
    ['revealed', ['questionShown', 'answeringStarted', 'myResult'], ['questionShown', 'answeringStarted', 'revealed']],
    [
      'fastest',
      ['questionShown', 'answeringStarted', 'myResult', 'fastest'],
      ['questionShown', 'answeringStarted', 'revealed', 'fastest'],
    ],
    [
      'standings',
      ['questionShown', 'answeringStarted', 'myResult', 'fastest', 'standings'],
      ['questionShown', 'answeringStarted', 'revealed', 'fastest', 'standings'],
    ],
    ['final', ['finalRanking'], ['finalRanking']],
  ] as const satisfies readonly (readonly [RoomPhase, readonly string[], readonly string[]])[];

  it.each(flow)('%s の段階で resume すると、resumed と参加者一覧に続けて %j が届く', async (phase, player) => {
    const { stub, token } = await roomAt(phase);

    const resumed = await resumePlayer(stub, token);

    expect(typesOf(await greeting(resumed))).toEqual(['resumed', 'participants', ...player]);
  });

  it.each(flow)('%s の段階で join すると、joined と参加者一覧に続けて %j が届く', async (phase, player) => {
    const { stub } = await roomAt(phase);

    const hanako = await joinPlayer(stub, 'はなこ');

    // joined は joinPlayer が読んでいる
    expect(typesOf(await drain(hanako))).toEqual(['participants', ...player]);
  });

  it.each(flow)(
    '%s の段階でホストがつなぐと、hostReady と参加者一覧に続けて、ホスト向けのその段階までのメッセージが届く',
    async (phase, _player, host) => {
      const { stub } = await roomAt(phase);

      const reconnected = await openHost(stub);

      expect(typesOf(await greeting(reconnected))).toEqual(['hostReady', 'participants', ...host]);
    },
  );

  it.each([
    ['3秒たったとき', 3_000, 7_000],
    ['締切ちょうど', LIMIT_MS, 0],
    // alarm が遅れて、締切を過ぎても受付中のままのとき。0 未満にはしない
    ['締切を2秒過ぎたとき', LIMIT_MS + 2_000, 0],
  ])(
    '受付中に resume すると、answeringStarted の remainingMs が「締切 − 今」になる（%s）',
    async (_case, passed, remaining) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const startedAt = Date.now();
      const { stub, token } = await roomAt('accepting');

      vi.setSystemTime(startedAt + passed);
      const messages = await greeting(await resumePlayer(stub, token));

      expect(messages).toContainEqual({
        type: 'answeringStarted',
        questionId: 'q-1',
        choices: ['寿司', '焼肉'],
        limitMs: LIMIT_MS,
        remainingMs: remaining,
      });
    },
  );

  it('受付中に、もう答えた回答者が resume すると、自分の回答（answerAccepted）が届く', async () => {
    const { stub, taro, token } = await roomAt('accepting');
    await exchange(taro, { type: 'answer', questionId: 'q-1', choiceIndex: 1, elapsedMs: 2_345 });

    const messages = await greeting(await resumePlayer(stub, token));

    expect(messages.at(-1)).toEqual({ type: 'answerAccepted', questionId: 'q-1', choiceIndex: 1, elapsedMs: 2_340 });
  });

  it('受付中にホストがつなぐと、今の回答数（answerProgress）が届く', async () => {
    const { stub, taro } = await roomAt('accepting');
    await joinPlayer(stub, 'はなこ');
    await exchange(taro, { type: 'answer', questionId: 'q-1', choiceIndex: 0, elapsedMs: 1_000 });

    const messages = await greeting(await openHost(stub));

    expect(messages.at(-1)).toEqual({
      type: 'answerProgress',
      questionId: 'q-1',
      answeredCount: 1,
      participantCount: 2,
    });
  });

  it.each(['question', 'accepting'] as const)(
    '%s の段階でつなぎ直しても、回答者にもホストにも正解が届かない（S2）',
    async (phase) => {
      const { stub, taro, token } = await roomAt(phase);
      if (phase === 'accepting') {
        await exchange(taro, { type: 'answer', questionId: 'q-1', choiceIndex: 0, elapsedMs: 1_000 });
      }

      const player = await greeting(await resumePlayer(stub, token));
      const host = await greeting(await openHost(stub));

      expect(JSON.stringify([...player, ...host])).not.toContain('correctIndex');
    },
  );

  it('送り直しは、つないだ本人にだけ届く。① の結果も本人の分だけ', async () => {
    const stub = await newRoom();
    const host = await connectHost(stub);
    const token = newToken();
    const taro = await joinPlayer(stub, 'たろう', token);
    const hanako = await joinPlayer(stub, 'はなこ');
    await exchange(host, { type: 'showQuestion', ...at(0) });
    await exchange(host, { type: 'startAnswering', ...at(0) });
    await exchange(taro, { type: 'answer', questionId: 'q-1', choiceIndex: 0, elapsedMs: 1_000 });
    await exchange(hanako, { type: 'answer', questionId: 'q-1', choiceIndex: 1, elapsedMs: 2_000 });
    await exchange(host, { type: 'closeAnswering', ...at(0) });
    // ここまでに届いたものを読み終えておく
    await drain(hanako);
    await drain(host);

    const messages = await greeting(await resumePlayer(stub, token));

    expect(messages.filter(({ type }) => type === 'myResult')).toEqual([
      expect.objectContaining({ answer: { choiceIndex: 0, elapsedMs: 1_000 }, correct: true }),
    ]);
    expect(await drain(hanako)).toEqual([]);
    expect(await drain(host)).toEqual([]);
  });
});
