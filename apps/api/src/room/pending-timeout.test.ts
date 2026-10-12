import { CLOSE_CODES } from '@zubatto-quiz/protocol';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeOf, connect, messageReader, newRoom, newToken, type RoomStub } from '../../test/room-socket';
import { countOpenConnections, MAX_CONNECTIONS } from './connections';
import { JOIN_TIMEOUT_MS } from './pending-timeout';

const player = { role: 'player' } as const;
const joinTimeout = { code: CLOSE_CODES.join_timeout, reason: 'join_timeout' };

/** 部屋の DO で開いている接続の本数（ホスト用と回答者用） */
const openCounts = (stub: RoomStub) => runInDurableObject(stub, (_instance, state) => countOpenConnections(state));

/** 回答者用の入口につなぎ、join を通す */
async function joinedPlayer(stub: RoomStub, name: string) {
  const ws = await connect(stub, player);
  const next = messageReader(ws);
  ws.send(JSON.stringify({ type: 'join', name, token: newToken() }));
  await next();
  return ws;
}

describe('未確認の接続の時間切れ（ADR 0004）', () => {
  let now: number;

  beforeEach(() => {
    // 部屋の DO もテストと同じ isolate で動くので、Date.now() の値をテストから進められる
    vi.useFakeTimers({ toFake: ['Date'] });
    now = Date.now();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = (ms: number) => vi.setSystemTime((now += ms));

  it('10秒を過ぎた未確認の接続は、alarm で 4408 join_timeout で閉じられ、入室した接続は閉じられない', async () => {
    const stub = await newRoom();
    const pending = await connect(stub, player);
    const closed = closeOf(pending);
    await joinedPlayer(stub, 'たろう');

    advance(JOIN_TIMEOUT_MS);

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await closed).toEqual(joinTimeout);
    expect(await openCounts(stub)).toEqual({ host: 0, player: 1 });
  });

  it('10秒を過ぎる前の alarm では閉じず、次の alarm で閉じる', async () => {
    const stub = await newRoom();
    const pending = await connect(stub, player);
    const closed = closeOf(pending);

    advance(JOIN_TIMEOUT_MS - 1);
    await runDurableObjectAlarm(stub);
    expect(await openCounts(stub)).toEqual({ host: 0, player: 1 });

    advance(1);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await closed).toEqual(joinTimeout);
  });

  it('evictDurableObject で休止させたあとも、alarm で閉じられる', async () => {
    const stub = await newRoom();
    const pending = await connect(stub, player);
    const closed = closeOf(pending);

    await evictDurableObject(stub);
    advance(JOIN_TIMEOUT_MS);

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await closed).toEqual(joinTimeout);
  });

  it('未確認の接続で100本を埋めても、10秒を過ぎたあとの新しい接続は、alarm を待たずに受け付けられる', async () => {
    const stub = await newRoom();
    const filled = [];
    for (let i = 0; i < MAX_CONNECTIONS; i++) {
      filled.push(await connect(stub, player));
    }
    const closedFirst = closeOf(filled[0] as WebSocket);

    advance(JOIN_TIMEOUT_MS);
    const late = await connect(stub, player);
    const lateClosed = vi.fn<() => void>();
    late.addEventListener('close', lateClosed);

    expect(await closedFirst).toEqual(joinTimeout);
    // 古い100本は閉じられ、新しい1本だけが開いている
    expect(await openCounts(stub)).toEqual({ host: 0, player: 1 });
    expect(lateClosed).not.toHaveBeenCalled();
  });
});
