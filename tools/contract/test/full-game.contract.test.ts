import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { ContractSocket, loginAsHost, request, roomSocketUrl, type ServerMessage } from '../src/client.ts';

/**
 * 1ゲームを、サーバーの外から HTTP と WebSocket だけで通す。届いたものはすべて openapi.json と ws.schema.json で調べる。
 * TS のサーバーでも Go のサーバーでも、同じシナリオがそのまま通ることを確かめる（ADR 0008）
 */

const origin = process.env.CONTRACT_ORIGIN ?? '';

/** correct は正解の番号（0から）。たろうはいつも正解し、はなこは第2問だけ正解する（e2e/full-game.spec.ts と同じ） */
const QUESTIONS = [
  { text: '日本でいちばん高い山は？', choices: ['富士山', '高尾山', '阿蘇山'], correct: 0, hanako: 1 },
  { text: '1 + 1 は？', choices: ['1', '2'], correct: 1, hanako: 1 },
  { text: '晴れた日の空の色は？', choices: ['赤', '青', '緑', '黄'], correct: 1, hanako: 3 },
] as const;

/** 締切はホストが送る。制限時間は、テストが遅れても先に alarm が締め切らない長さにする（F9 の上限は60秒） */
const LIMIT_MS = 60_000;

const questionSet = {
  title: '契約テストの問題セット',
  questions: QUESTIONS.map(({ text, choices, correct }) => ({
    text,
    choices: [...choices],
    correctIndex: correct,
    limitMs: LIMIT_MS,
  })),
};

/** ホストに届く type。answerProgress と revealed はホストにだけ届く */
const HOST_TYPES = [
  'hostReady',
  'participants',
  'questionShown',
  'answeringStarted',
  'answerProgress',
  'revealed',
  'fastest',
  'standings',
  'finalRanking',
];

/** 回答者に届く type。正解の番号は myResult で自分の分だけ届く */
const PLAYER_TYPES = [
  'joined',
  'participants',
  'questionShown',
  'answeringStarted',
  'answerAccepted',
  'myResult',
  'fastest',
  'standings',
  'finalRanking',
];

/** 回答者と同じ形の秘密（32バイトの base64url）。テストのメモリにだけ持ち、出力しない */
const newToken = () => randomBytes(32).toString('base64url');

/** questionId がその問題のメッセージ */
const about = (questionId: unknown) => (message: ServerMessage) => message.questionId === questionId;

const sockets: ContractSocket[] = [];

/** 開いた接続を、テストのあとで閉じるために覚えておく */
async function connect(...args: ConstructorParameters<typeof ContractSocket>): Promise<ContractSocket> {
  const socket = new ContractSocket(...args);
  sockets.push(socket);
  await socket.opened;
  return socket;
}

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});

describe.skipIf(!origin)('1ゲーム', () => {
  it('ホストが問題セットを作って部屋を開き、2人が最後まで遊べる', { timeout: 60_000 }, async () => {
    const session = await loginAsHost(origin);

    // 問題セットを作り、一覧と1件で読み、名前を変える（F4・F9）
    const created = await request(session, 'POST /api/question-sets', { body: questionSet });
    expect(created.status).toBe(201);
    const { id } = created.body as { id: string };
    const params = { id };

    const listed = await request(session, 'GET /api/question-sets');
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ questionSets: [{ id, title: questionSet.title, questionCount: 3 }] });

    const read = await request(session, 'GET /api/question-sets/{id}', { params });
    expect(read).toMatchObject({ status: 200, body: { id, title: questionSet.title } });

    const renamed = { ...questionSet, title: '契約テストの問題セット（改）' };
    expect(await request(session, 'PUT /api/question-sets/{id}', { params, body: renamed })).toEqual({
      status: 204,
      body: undefined,
    });

    // 部屋を作る（F1）。部屋は問題セットを写すので、このあとセットを消しても遊べる
    const room = await request(session, 'POST /api/rooms', { body: { questionSetId: id } });
    expect(room.status).toBe(201);
    const { roomId } = room.body as { roomId: string };

    // ホストがつなぐと、部屋の今の状態が届く
    const host = await connect({ url: roomSocketUrl(origin, roomId, 'host'), origin, cookie: session.cookie });
    expect(await host.waitFor('hostReady')).toMatchObject({
      room: { title: renamed.title, questionCount: 3, phase: 'lobby', questionIndex: null },
    });

    // 2人が入る（F2・F3）。回答者の入口へは Cookie を付けない
    const join = async (name: string) => {
      const socket = await connect({ url: roomSocketUrl(origin, roomId, 'play'), origin });
      socket.send({ type: 'join', name, token: newToken() });
      const { participantId } = await socket.waitFor('joined');
      return { socket, participantId };
    };
    const taro = await join('たろう');
    const hanako = await join('はなこ');
    const players = [taro, hanako];
    const everyone = [host, taro.socket, hanako.socket];
    const bothJoined = (message: ServerMessage) =>
      Array.isArray(message.participants) && message.participants.length === 2;
    for (const socket of everyone) {
      expect(await socket.waitFor('participants', bothJoined)).toEqual({
        type: 'participants',
        participants: [
          { participantId: taro.participantId, name: 'たろう' },
          { participantId: hanako.participantId, name: 'はなこ' },
        ],
      });
    }

    for (const [questionIndex, question] of QUESTIONS.entries()) {
      // 出題。全員に問題文が届き、questionId もここで知る（F8）
      host.send({ type: 'showQuestion', questionIndex });
      const shown = (message: ServerMessage) => message.questionIndex === questionIndex;
      const { questionId } = await host.waitFor('questionShown', shown);
      for (const socket of everyone) {
        expect(await socket.waitFor('questionShown', shown)).toMatchObject({ questionId, text: question.text });
      }

      // 受付を始め、2人が答える（F8・F10）
      host.send({ type: 'startAnswering', questionIndex });
      for (const socket of everyone) {
        expect(await socket.waitFor('answeringStarted', about(questionId))).toMatchObject({
          choices: question.choices,
        });
      }
      for (const [player, choiceIndex] of [
        [taro, question.correct],
        [hanako, question.hanako],
      ] as const) {
        player.socket.send({ type: 'answer', questionId, choiceIndex, elapsedMs: 1_000 });
        expect(await player.socket.waitFor('answerAccepted', about(questionId))).toMatchObject({ choiceIndex });
      }
      await host.waitFor(
        'answerProgress',
        (message) => message.questionId === questionId && message.answeredCount === 2,
      );

      // ① 締切。ホストには分布、回答者には自分の結果が届く（F11）
      host.send({ type: 'closeAnswering', questionIndex });
      expect(await host.waitFor('revealed', about(questionId))).toMatchObject({ correctIndex: question.correct });
      expect(await taro.socket.waitFor('myResult', about(questionId))).toMatchObject({ correct: true });
      expect(await hanako.socket.waitFor('myResult', about(questionId))).toMatchObject({
        correct: question.hanako === question.correct,
      });

      // ② 最速正解（F14）。たろうはいつも正解するので、必ず最速の3人に入る。
      // 最後の2問は順位を隠す形（ranksHidden: true）、それより前は一番順位を上げた人を持つ形で届くので、両方の形を通る
      const lastTwo = questionIndex >= QUESTIONS.length - 2;
      host.send({ type: 'revealFastest', questionIndex });
      for (const socket of everyone) {
        const fastest = await socket.waitFor('fastest', about(questionId));
        expect(fastest).toMatchObject({ ranksHidden: lastTwo });
        expect('biggestClimber' in fastest).toBe(!lastTwo);
        expect(fastest.fastest).toContainEqual(expect.objectContaining({ name: 'たろう' }));
      }

      // ③ 途中経過。最後の2問では出せないので、3問のうち第1問だけ（F15）
      if (!lastTwo) {
        host.send({ type: 'showStandings', questionIndex });
        for (const socket of everyone) await socket.waitFor('standings', about(questionId));
      }
    }

    // 最終ランキング（F16）。いつも正解したたろうが1位
    host.send({ type: 'showFinalRanking' });
    for (const socket of everyone) {
      const ranking = await socket.waitFor('finalRanking');
      expect(ranking.entries).toMatchObject([
        { name: 'たろう', rank: 1 },
        { name: 'はなこ', rank: 2 },
      ]);
    }

    // 部屋を終えると、全員の接続が room_ended（4410）で閉じる
    host.send({ type: 'endRoom' });
    for (const socket of everyone) expect(await socket.closed).toBe(4410);

    // 届いた種類。足りなければシナリオが仕様の一部を通っていない。多ければ届くはずのない人に届いている
    expect(host.types).toEqual(new Set(HOST_TYPES));
    for (const { socket } of players) expect(socket.types).toEqual(new Set(PLAYER_TYPES));

    // 部屋を作ったあとなら、問題セットを消せる
    expect(await request(session, 'DELETE /api/question-sets/{id}', { params })).toEqual({
      status: 204,
      body: undefined,
    });
  });
});
