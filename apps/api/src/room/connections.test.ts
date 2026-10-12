import { CLOSE_CODES } from '@zubatto-quiz/protocol';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { closeOf, newRoom, openSocket } from '../../test/room-socket';
import { getAttachment } from './attachment';
import {
  countOpenConnections,
  MAX_CONNECTIONS,
  MAX_HOST_CONNECTIONS,
  roomRequest,
  type RoomEntry,
} from './connections';

type RoomStub = Awaited<ReturnType<typeof newRoom>>;

const player = { role: 'player' } satisfies RoomEntry;
const host = { role: 'host', ownerId: 'alice' } satisfies RoomEntry;

/** Worker を通さず、部屋の DO へ直接つなぐ */
const connect = async (stub: RoomStub, entry: RoomEntry) => openSocket(await stub.fetch(roomRequest(entry)));

/** 部屋の DO が受け付けている接続の attachment を、すべて読む */
const readAttachments = (stub: RoomStub) =>
  runInDurableObject(stub, (_instance, state) => state.getWebSockets().map(getAttachment));

/** 回答者用の接続を count 本、順番に開く */
async function fill(stub: RoomStub, count: number): Promise<WebSocket[]> {
  const sockets = [];
  for (let i = 0; i < count; i++) {
    sockets.push(await connect(stub, player));
  }
  return sockets;
}

describe('1部屋の接続の上限（ADR 0004）', () => {
  it('100本つないだ状態で、101本目の接続は 4503 で閉じられる', async () => {
    const stub = await newRoom();
    await fill(stub, MAX_CONNECTIONS);

    const overflow = await connect(stub, player);

    expect(await closeOf(overflow)).toEqual({ code: CLOSE_CODES.connection_limit, reason: 'connection_limit' });
    expect(await readAttachments(stub)).toHaveLength(MAX_CONNECTIONS);
  });

  it('99本つないだ状態で2本が同時に来ても、受け付けるのは1本だけで100本を超えない', async () => {
    const stub = await newRoom();
    await fill(stub, MAX_CONNECTIONS - 1);

    const [first, second] = await Promise.all([connect(stub, player), connect(stub, player)]);

    // どちらが先に通るかは決まらないので、先に閉じられたほうを見る。両方を受け付けていれば、DO の本数が101になる
    const closed = await Promise.race([closeOf(first), closeOf(second)]);
    expect(closed).toEqual({ code: CLOSE_CODES.connection_limit, reason: 'connection_limit' });
    expect(await readAttachments(stub)).toHaveLength(MAX_CONNECTIONS);
  });

  it('回答者用の入口から100本を埋めても、部屋の持ち主のホストはつなげる', async () => {
    const stub = await newRoom();
    await fill(stub, MAX_CONNECTIONS);

    await connect(stub, host);

    const attachments = await readAttachments(stub);
    expect(attachments.filter((attachment) => attachment === null)).toHaveLength(MAX_CONNECTIONS);
    expect(attachments.filter((attachment) => attachment?.role === 'host')).toHaveLength(1);
  });

  it('ホストの接続は回答者用の100本に数えず、5本までつなげる', async () => {
    const stub = await newRoom();
    for (let i = 0; i < MAX_HOST_CONNECTIONS; i++) {
      await connect(stub, host);
    }
    await fill(stub, MAX_CONNECTIONS);

    // 次の接続を待つあいだに close が届くので、開いたらすぐ待ち受ける
    const extraHost = closeOf(await connect(stub, host));
    const extraPlayer = closeOf(await connect(stub, player));

    expect(await extraHost).toEqual({ code: CLOSE_CODES.connection_limit, reason: 'connection_limit' });
    expect(await extraPlayer).toEqual({ code: CLOSE_CODES.connection_limit, reason: 'connection_limit' });
    expect(await readAttachments(stub)).toHaveLength(MAX_HOST_CONNECTIONS + MAX_CONNECTIONS);
  });

  it('DO が閉じて、相手の close を待っている接続（CLOSING）は数えない', async () => {
    const stub = await newRoom();
    await connect(stub, host);
    await fill(stub, MAX_CONNECTIONS);

    const counts = await runInDurableObject(stub, (_instance, state) => {
      // ホストの接続と、未確認の接続の1本ずつを閉じる
      const sockets = state.getWebSockets();
      sockets.find((ws) => getAttachment(ws)?.role === 'host')?.close(1000, 'bye');
      sockets.find((ws) => getAttachment(ws) === null)?.close(CLOSE_CODES.join_timeout, 'join_timeout');
      // 同じ同期の処理の中なので、相手の close はまだ届いておらず、getWebSockets() には残っている
      return { listed: state.getWebSockets().length, open: countOpenConnections(state) };
    });

    expect(counts).toEqual({ listed: MAX_CONNECTIONS + 1, open: { host: 0, player: MAX_CONNECTIONS - 1 } });
  });
});
