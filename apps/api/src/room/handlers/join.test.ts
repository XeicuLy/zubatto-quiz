import { CLOSE_CODES, type Joined } from '@zubatto-quiz/protocol';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeOf, connect, messageReader, newRoom, newToken, type RoomStub } from '../../../test/room-socket';
import { getAttachment } from '../attachment';
import { hashToken } from '../token-hash';
import { MAX_PARTICIPANTS } from './join';

const player = { role: 'player' } as const;

const sendJoin = (ws: WebSocket, name: string, token = newToken()) =>
  ws.send(JSON.stringify({ type: 'join', name, token }));

/** 回答者用の入口につなぎ、join を送る。届いたメッセージを読む関数と、閉じたときの code を待つ Promise も返す */
async function joinAs(stub: RoomStub, name: string, token = newToken()) {
  const ws = await connect(stub, player);
  const next = messageReader(ws);
  const closed = closeOf(ws);
  sendJoin(ws, name, token);
  return { ws, next, closed };
}

/** 部屋の DO が受け付けている接続の attachment を、すべて読む */
const readAttachments = (stub: RoomStub) =>
  runInDurableObject(stub, (_instance, state) => state.getWebSockets().map(getAttachment));

/** 部屋の DO の参加者の表を、入室した順に読む */
const readParticipants = (stub: RoomStub) =>
  runInDurableObject(stub, (_instance, state) =>
    state.storage.sql
      .exec<{ participant_id: string; name: string }>(
        'SELECT participant_id, name FROM participants ORDER BY join_order',
      )
      .toArray(),
  );

describe('join（F2・ADR 0004）', () => {
  it('join が通ると、participantId と部屋の要約が届き、表示名で参加者の表に書かれる', async () => {
    const stub = await newRoom();

    const { next } = await joinAs(stub, ' たろう ');

    const joined = await next();
    expect(joined).toEqual({
      type: 'joined',
      participantId: expect.any(String),
      room: { title: 'テストの部屋', questionCount: 1, phase: 'lobby', questionIndex: null },
    });
    expect(await readParticipants(stub)).toEqual([
      { participant_id: (joined as { participantId: string }).participantId, name: 'たろう' },
    ]);
  });

  it.each([
    ['同じ名前', 'たろう', 'たろう'],
    ['全角と半角の英数字', 'TARO1', 'ＴＡＲＯ１'],
    ['半角と全角のカタカナ', 'タロウ', 'ﾀﾛｳ'],
    ['前後の空白', 'たろう', '\u3000たろう\u3000'],
  ])('%s のかぶりは 4409 name_taken で閉じ、参加者を増やさない', async (_case, first, second) => {
    const stub = await newRoom();
    await (await joinAs(stub, first)).next();

    const { closed } = await joinAs(stub, second);

    expect(await closed).toEqual({ code: CLOSE_CODES.name_taken, reason: 'name_taken' });
    expect(await readParticipants(stub)).toHaveLength(1);
  });

  it('部屋が終わったあとの join は 4410 room_ended で閉じる', async () => {
    const stub = await newRoom();
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('UPDATE room SET ended_at = ?', Date.now());
    });

    const { closed } = await joinAs(stub, 'たろう');

    expect(await closed).toEqual({ code: CLOSE_CODES.room_ended, reason: 'room_ended' });
    expect(await readParticipants(stub)).toEqual([]);
  });
});

describe('部屋の上限（SC1・ADR 0004）', () => {
  it('49名のときに join が2件同時に来ても、受け付けるのは1件だけで50名を超えない', async () => {
    const stub = await newRoom();
    await runInDurableObject(stub, (_instance, state) => {
      for (let i = 1; i < MAX_PARTICIPANTS; i++) {
        state.storage.sql.exec(
          'INSERT INTO participants (participant_id, name, normalized_name, token_hash, joined_at) VALUES (?, ?, ?, randomblob(32), ?)',
          crypto.randomUUID(),
          `回答者${i}`,
          `回答者${i}`,
          Date.now(),
        );
      }
    });
    const [first, second] = await Promise.all([connect(stub, player), connect(stub, player)]);
    const closed = Promise.race([closeOf(first), closeOf(second)]);

    sendJoin(first, 'たろう');
    sendJoin(second, 'はなこ');

    // どちらが先に通るかは決まらないので、先に閉じられたほうを見る
    expect(await closed).toEqual({ code: CLOSE_CODES.room_full, reason: 'room_full' });
    expect(await readParticipants(stub)).toHaveLength(MAX_PARTICIPANTS);
  });
});

describe('未確認の接続（ADR 0004）', () => {
  it.each([
    ['回答', { type: 'answer', questionId: 'q-1', choiceIndex: 0, elapsedMs: 1_000 }],
    ['進行操作', { type: 'showQuestion', questionIndex: 0 }],
  ])('%s を送ると not_verified が返り、未確認のまま', async (_case, message) => {
    const stub = await newRoom();
    const ws = await connect(stub, player);
    const next = messageReader(ws);

    ws.send(JSON.stringify(message));

    expect(await next()).toEqual({ type: 'error', code: 'not_verified' });
    expect(await readAttachments(stub)).toEqual([null]);
  });

  it.each([
    ['31バイト', btoa('a'.repeat(31)).replaceAll('=', '')],
    ['33バイト', btoa('a'.repeat(33)).replaceAll('=', '')],
    // 43文字の base64url は258ビットを表す。32バイトちょうどなら、最後の文字の下2ビットは0になる
    ['43文字だが32バイトちょうどでない', `${'A'.repeat(42)}B`],
  ])('token が %s の join は invalid_message で断り、参加者を登録しない', async (_case, token) => {
    const stub = await newRoom();
    const ws = await connect(stub, player);
    const next = messageReader(ws);

    sendJoin(ws, 'たろう', token);

    expect(await next()).toEqual({ type: 'error', code: 'invalid_message' });
    expect(await readParticipants(stub)).toEqual([]);
    expect(await readAttachments(stub)).toEqual([null]);
  });
});

describe('休止のあと（A1・ADR 0004）', () => {
  it('evictDurableObject で休止したあとも attachment が残り、同じ回答者として扱われる', async () => {
    const stub = await newRoom();
    const { ws, next } = await joinAs(stub, 'たろう');
    const { participantId } = (await next()) as Joined;
    await next(); // 参加者一覧

    await evictDurableObject(stub);
    // 起こした DO は、この接続を回答者として見るので、2回目の join を断る
    sendJoin(ws, 'じろう');

    expect(await next()).toEqual({ type: 'error', code: 'invalid_state' });
    expect(await readAttachments(stub)).toEqual([{ role: 'player', participantId }]);
    expect(await readParticipants(stub)).toEqual([{ participant_id: participantId, name: 'たろう' }]);
  });
});

describe('秘密と個人情報（S5・ADR 0004）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('秘密は応答にもログにも出ず、表には名前と秘密の SHA-256 だけが残る', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method));
    const token = newToken();

    const stub = await newRoom();
    const { ws, next } = await joinAs(stub, 'たろう', token);
    // 検査に通らないメッセージにも秘密を入れて送る
    sendJoin(ws, '', token);
    const messages = [await next(), await next(), await next()];

    expect(messages.at(-1)).toEqual({ type: 'error', code: 'invalid_message' });
    expect(JSON.stringify(messages)).not.toContain(token);
    for (const spy of logs) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(token);
    }
    const rows = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql.exec<Record<string, SqlStorageValue>>('SELECT * FROM participants').toArray(),
    );
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'join_order',
      'joined_at',
      'name',
      'normalized_name',
      'participant_id',
      'token_hash',
    ]);
    expect(new Uint8Array(row?.token_hash as ArrayBuffer)).toEqual(new Uint8Array(await hashToken(token)));
  });
});

describe('参加者一覧（F3）', () => {
  it('入室のたびに、ホストと入室した回答者の全員へ届き、未確認の接続には届かない', async () => {
    const stub = await newRoom();
    const host = messageReader(await connect(stub, { role: 'host', ownerId: 'alice' }));
    const pendingWs = await connect(stub, player);
    const pending = messageReader(pendingWs);

    const taro = await joinAs(stub, 'たろう');
    const taroId = ((await taro.next()) as Joined).participantId;
    expect(await taro.next()).toEqual({
      type: 'participants',
      participants: [{ participantId: taroId, name: 'たろう' }],
    });
    const hanako = await joinAs(stub, 'はなこ');
    const hanakoId = ((await hanako.next()) as Joined).participantId;

    const both = {
      type: 'participants',
      participants: [
        { participantId: taroId, name: 'たろう' },
        { participantId: hanakoId, name: 'はなこ' },
      ],
    };
    expect(await hanako.next()).toEqual(both);
    expect(await taro.next()).toEqual(both);
    expect(await host()).toEqual({ type: 'participants', participants: [{ participantId: taroId, name: 'たろう' }] });
    expect(await host()).toEqual(both);
    // 未確認の接続に最初に届くのが、自分で送った誤りへの応答なら、参加者一覧は届いていない
    pendingWs.send('not json');
    expect(await pending()).toEqual({ type: 'error', code: 'invalid_message' });
  });
});
