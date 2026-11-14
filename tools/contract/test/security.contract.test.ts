import { randomBytes, randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ContractSocket,
  handshakeStatus,
  loginAsHost,
  request,
  roomSocketUrl,
  type HostSession,
  type ServerMessage,
} from '../src/client.ts';

/**
 * 安全の約束を、サーバーの外から HTTP と WebSocket だけで確かめる。
 * 部屋の DO の中を読むテスト（apps/api の runInDurableObject）は Go のサーバーには使えないので、
 * 閉じたときの code・届いたメッセージ・HTTP の状態コードだけで確かめられるものを選んだ（外から確かめられないものは README）
 */

const origin = process.env.CONTRACT_ORIGIN ?? '';

/** 締切はホストが送る。制限時間は、テストが遅れても先に alarm が締め切らない長さにする（F9 の上限は60秒） */
const LIMIT_MS = 60_000;
const CORRECT = 0;

const questionSet = {
  title: '安全の約束を確かめる問題セット',
  questions: [
    {
      text: '日本でいちばん高い山は？',
      choices: ['富士山', '高尾山', '阿蘇山'],
      correctIndex: CORRECT,
      limitMs: LIMIT_MS,
    },
  ],
};

/** 閉じるときの code。ws.schema.json の CloseCode と同じ番号 */
const CLOSE = { replaced: 4301, room_not_found: 4404 } as const;

/** 回答者と同じ形の秘密（32バイトの base64url）。テストのメモリにだけ持ち、出力しない */
const newToken = () => randomBytes(32).toString('base64url');

const sockets: ContractSocket[] = [];

/** 接続を開き、テストのあとで閉じるために覚えておく。断られる接続は、開くのを待たずに closed を見る */
function track(...args: ConstructorParameters<typeof ContractSocket>): ContractSocket {
  const socket = new ContractSocket(...args);
  sockets.push(socket);
  return socket;
}

async function connect(...args: ConstructorParameters<typeof ContractSocket>): Promise<ContractSocket> {
  const socket = track(...args);
  await socket.opened;
  return socket;
}

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});

/** 新しいホストで問題セットと部屋を作り、ホストの接続を開く */
async function openRoom() {
  const session = await loginAsHost(origin);
  const created = await request(session, 'POST /api/question-sets', { body: questionSet });
  expect(created.status).toBe(201);
  const { id: questionSetId } = created.body as { id: string };
  const room = await request(session, 'POST /api/rooms', { body: { questionSetId } });
  expect(room.status).toBe(201);
  const { roomId } = room.body as { roomId: string };
  const host = await connectHost(session, roomId);
  return { session, questionSetId, roomId, host };
}

async function connectHost(session: HostSession, roomId: string): Promise<ContractSocket> {
  const host = await connect({ url: roomSocketUrl(origin, roomId, 'host'), origin, cookie: session.cookie });
  await host.waitFor('hostReady');
  return host;
}

/** 回答者用の入口を開く。join も resume もまだ送っていない、未確認の接続 */
const connectPlayer = (roomId: string) => connect({ url: roomSocketUrl(origin, roomId, 'play'), origin });

async function join(roomId: string, name: string) {
  const token = newToken();
  const socket = await connectPlayer(roomId);
  socket.send({ type: 'join', name, token });
  const { participantId } = await socket.waitFor('joined');
  return { socket, participantId, token };
}

/** 同じ秘密で、別の接続からつなぎ直す（別のタブ・電波が戻ったとき） */
async function resume(roomId: string, token: string) {
  const socket = await connectPlayer(roomId);
  socket.send({ type: 'resume', token });
  return { socket, resumed: await socket.waitFor('resumed') };
}

/** 出題して受付を始め、questionId を返す */
async function startQuestion(host: ContractSocket): Promise<unknown> {
  host.send({ type: 'showQuestion', questionIndex: 0 });
  const { questionId } = await host.waitFor('questionShown');
  host.send({ type: 'startAnswering', questionIndex: 0 });
  await host.waitFor('answeringStarted');
  return questionId;
}

/** 正解の番号を持つメッセージか。ws.schema.json はどの形も知らないキーを許さないので、別の名前で漏れればスキーマで落ちる */
const hasCorrectIndex = (message: ServerMessage) => JSON.stringify(message).includes('"correctIndex":');

/** type のメッセージより前に届いたものすべて。type が届いていなければ全部 */
function receivedBefore(socket: ContractSocket, type: string): readonly ServerMessage[] {
  const messages = socket.messages;
  const end = messages.findIndex((message) => message.type === type);
  return end === -1 ? messages : messages.slice(0, end);
}

describe.skipIf(!origin)('安全の約束', { timeout: 30_000 }, () => {
  describe('S1: 他のホストの部屋と問題セットは、ないものと同じに見える', () => {
    it('他のホストの部屋にホストとしてつなぐと、ない部屋と同じ 4404 で閉じ、何も届かない', async () => {
      const { roomId } = await openRoom();
      const mallory = await loginAsHost(origin);

      const intruder = track({ url: roomSocketUrl(origin, roomId, 'host'), origin, cookie: mallory.cookie });
      const missing = track({
        url: roomSocketUrl(origin, randomBytes(32).toString('hex'), 'host'),
        origin,
        cookie: mallory.cookie,
      });

      expect(await intruder.closed).toBe(CLOSE.room_not_found);
      expect(await missing.closed).toBe(CLOSE.room_not_found);
      expect(intruder.messages).toEqual([]);
    });

    it('他のホストの問題セットは、読む・変える・消す・部屋を作るのどれも、ない ID と同じ 404 になる', async () => {
      const alice = await openRoom();
      const mallory = await loginAsHost(origin);

      for (const id of [alice.questionSetId, randomUUID()]) {
        const params = { id };
        expect((await request(mallory, 'GET /api/question-sets/{id}', { params })).status).toBe(404);
        expect((await request(mallory, 'PUT /api/question-sets/{id}', { params, body: questionSet })).status).toBe(404);
        expect((await request(mallory, 'DELETE /api/question-sets/{id}', { params })).status).toBe(404);
        expect((await request(mallory, 'POST /api/rooms', { body: { questionSetId: id } })).status).toBe(404);
      }
      // 一覧にも出ない
      expect(await request(mallory, 'GET /api/question-sets')).toEqual({ status: 200, body: { questionSets: [] } });

      // 持ち主からは、変わらずに読める
      const read = await request(alice.session, 'GET /api/question-sets/{id}', {
        params: { id: alice.questionSetId },
      });
      expect(read).toMatchObject({ status: 200, body: { title: questionSet.title } });
    });
  });

  describe('S1: ホストだけの HTTP API は、ログインしていない人に 401 を返す', () => {
    it('GET /api/me は、cookie がなければ 401 で、ログインしたホストには自分が管理者かを返す（ADR 0013）', async () => {
      expect(await request({ origin }, 'GET /api/me')).toEqual({ status: 401, body: { error: 'unauthorized' } });

      // テスト用のログインのホストは管理者でない。形は openapi.json の MeResponse で調べている
      expect(await request(await loginAsHost(origin), 'GET /api/me')).toEqual({
        status: 200,
        body: { isAdmin: false },
      });
    });
  });

  describe('S2: 締切の前に、正解の番号は誰にも届かない', () => {
    it('受付中につなぎ直したホストと回答者を含め、締切の前に届いたどのメッセージにも correctIndex がない', async () => {
      const { session, roomId, host } = await openRoom();
      const taro = await join(roomId, 'たろう');
      const hanako = await join(roomId, 'はなこ');

      const questionId = await startQuestion(host);
      for (const { socket } of [taro, hanako]) await socket.waitFor('answeringStarted');
      taro.socket.send({ type: 'answer', questionId, choiceIndex: CORRECT, elapsedMs: 1_000 });
      await taro.socket.waitFor('answerAccepted');
      await host.waitFor('answerProgress', (message) => message.answeredCount === 1);

      // 受付中につなぎ直すと、部屋の今の状態が届く。DO が状態を組み立てて送るので、いちばん漏れやすい
      const host2 = await connectHost(session, roomId);
      const taro2 = await resume(roomId, taro.token);
      expect(await taro.socket.closed).toBe(CLOSE.replaced);

      // 締め切る。ホストには revealed、回答者には myResult で、ここで初めて正解の番号が届く
      host.send({ type: 'closeAnswering', questionIndex: 0 });
      const ends = [
        [host, 'revealed'],
        [host2, 'revealed'],
        [taro2.socket, 'myResult'],
        [hanako.socket, 'myResult'],
      ] as const;
      for (const [socket, type] of ends) {
        // 締切のあとには届く。届かなければ、この確かめ方が正解の番号を見つけられないことになる
        expect(hasCorrectIndex(await socket.waitFor(type))).toBe(true);
        expect(receivedBefore(socket, type).filter(hasCorrectIndex)).toEqual([]);
      }
      // 締切の前に置き換えで閉じた接続も、閉じるまでに届いたものに正解の番号がない
      expect(taro.socket.messages.filter(hasCorrectIndex)).toEqual([]);
    });
  });

  describe('X1: 同じ回答者が別の接続でつなぐと、古い接続だけが閉じる', () => {
    it('同じ秘密で resume すると、古い接続は 4301 で閉じ、新しい接続とほかの人には続けて届く', async () => {
      const { roomId, host } = await openRoom();
      const taro = await join(roomId, 'たろう');
      const hanako = await join(roomId, 'はなこ');

      const taro2 = await resume(roomId, taro.token);

      expect(taro2.resumed).toMatchObject({ participantId: taro.participantId, name: 'たろう' });
      expect(await taro.socket.closed).toBe(CLOSE.replaced);

      // 出題が、ホスト・ほかの回答者・新しい接続には届く。開いたままなので届く
      host.send({ type: 'showQuestion', questionIndex: 0 });
      for (const socket of [host, hanako.socket, taro2.socket]) await socket.waitFor('questionShown');
      expect(taro.socket.types.has('questionShown')).toBe(false);
    });
  });

  describe('未確認の接続（ADR 0004）', () => {
    it('join も resume も送っていない接続は、回答も進行操作も not_verified で返され、全員へのメッセージも届かない', async () => {
      const { roomId, host } = await openRoom();
      await join(roomId, 'たろう');
      const pending = await connectPlayer(roomId);

      // 出題のあとに送るので、出題が未確認の接続にも配られていれば、エラーより先に届いている
      host.send({ type: 'showQuestion', questionIndex: 0 });
      const { questionId } = await host.waitFor('questionShown');
      pending.send({ type: 'startAnswering', questionIndex: 0 });
      const first = await pending.waitFor('error');

      host.send({ type: 'startAnswering', questionIndex: 0 });
      await host.waitFor('answeringStarted');
      pending.send({ type: 'answer', questionId, choiceIndex: CORRECT, elapsedMs: 1_000 });
      await pending.waitFor('error', (message) => message !== first);

      // エラーを返しても閉じず、エラーのほかには何も届いていない
      const notVerified = { type: 'error', code: 'not_verified' };
      expect(pending.messages).toEqual([notVerified, notVerified]);
      // 進行操作は受け付けられていない。受け付けていれば、あとから送ったホストの startAnswering が invalid_state で返る。
      // ホストへの応答は順に届くので、締切まで進めてから、ホストに error が1つも来ていないことを見る
      host.send({ type: 'closeAnswering', questionIndex: 0 });
      await host.waitFor('revealed');
      expect(host.types.has('error')).toBe(false);
    });
  });

  describe.each(['host', 'play'] as const)('Origin の確かめ（%s の入口・S1・ADR 0003）', (entry) => {
    /** 新しい部屋のこの入口と、部屋の持ち主の Cookie。Cookie があっても、Origin が違えば断ることを見る */
    async function target() {
      const { session, roomId } = await openRoom();
      return { roomId, cookie: session.cookie, url: roomSocketUrl(origin, roomId, entry) };
    }

    const refused = [
      ['Origin のない', {}],
      ['別のオリジンからの', { Origin: 'https://evil.example' }],
    ] as const;

    it('同じオリジンからの握手は受け付ける（101）。下の確かめが、握手の作り方のせいで通っていないことを見る', async () => {
      const { url, cookie } = await target();

      expect(await handshakeStatus(url, { Cookie: cookie, Origin: origin })).toBe(101);
    });

    it.each(refused)('%s握手は、ログインしていても受け付けない', async (_, headers) => {
      const { url, cookie } = await target();

      // 本番と Go のサーバーは 403 を返す。vite preview は 101 でない応答を返さずに接続を切る（null）
      expect([403, null]).toContain(await handshakeStatus(url, { Cookie: cookie, ...headers }));
    });

    it.each(refused)(
      '%s要求は、Upgrade がなくても 403 で断る（Origin は Upgrade より先に確かめる）',
      async (_, headers) => {
        const { roomId, cookie } = await target();

        // 握手では状態コードが見えないサーバーがあるので、状態コードはここで確かめる。Node の fetch は GET に Origin を付けない
        const response = await fetch(new URL(`/api/rooms/${roomId}/ws/${entry}`, origin), {
          headers: { Cookie: cookie, ...headers },
        });
        expect(response.status).toBe(403);
      },
    );
  });
});
