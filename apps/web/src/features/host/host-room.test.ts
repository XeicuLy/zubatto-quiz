import { CLOSE_CODES } from '@zubatto-quiz/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeRoomServer } from '../../../test/fake-room-server';
import { createHostRoom } from './host-room';

const ROOM_ID = 'a'.repeat(64);
const URL = `ws://localhost/api/rooms/${ROOM_ID}/ws/host`;
const ROOM = { title: 'テスト', questionCount: 3, phase: 'lobby', questionIndex: null } as const;
const PARTICIPANT_ID = '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e6f';

function setup() {
  const server = new FakeRoomServer();
  const host = createHostRoom({ url: URL, createSocket: server.createSocket });
  return { server, host, state: () => host.room.getState() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ホスト用の接続（ADR 0003）', () => {
  it('connect でホスト用の入口を開き、最初のメッセージは送らない', () => {
    const { server, host } = setup();

    host.connect();
    server.latest.open();

    expect(server.sockets).toHaveLength(1);
    expect(server.latest.url).toBe(URL);
    // ホストは Cookie で持ち主かを確かめるので、join も resume も送らない
    expect(server.latest.received).toEqual([]);
  });

  it('hostReady と participants を部屋の store に写す（F3）', () => {
    const { server, host, state } = setup();

    host.connect();
    server.latest.open();
    server.latest.emit({ type: 'hostReady', room: ROOM });
    server.latest.emit({ type: 'participants', participants: [{ participantId: PARTICIPANT_ID, name: 'たろう' }] });

    expect(state()).toMatchObject({
      connection: 'open',
      room: ROOM,
      participants: [{ participantId: PARTICIPANT_ID, name: 'たろう' }],
    });
  });

  it('connect を2回呼んでも、接続は1本だけ', () => {
    const { server, host } = setup();

    host.connect();
    host.connect();

    expect(server.sockets).toHaveLength(1);
  });

  it('切れたらつなぎ直す（A1）', () => {
    const { server, host, state } = setup();

    host.connect();
    server.latest.open();
    server.latest.closeFromServer(1006);

    expect(state().connection).toBe('reconnecting');
    vi.runOnlyPendingTimers();
    expect(server.sockets).toHaveLength(2);
  });

  it('部屋が終わったら、つなぎ直さずに理由を残す', () => {
    const { server, host, state } = setup();

    host.connect();
    server.latest.open();
    server.latest.closeFromServer(CLOSE_CODES.room_ended);
    vi.runAllTimers();

    expect(state()).toMatchObject({ connection: 'closed', closeReason: 'room_ended' });
    expect(server.sockets).toHaveLength(1);
  });

  it('leave で閉じ、もうつなぎ直さない', () => {
    const { server, host } = setup();

    host.connect();
    server.latest.open();
    host.leave();
    vi.runAllTimers();

    expect(server.latest.readyState).toBe(WebSocket.CLOSED);
    expect(server.sockets).toHaveLength(1);
  });

  it('leave のあとに connect すると、新しく開き直す', () => {
    const { server, host } = setup();

    host.connect();
    host.leave();
    host.connect();

    expect(server.sockets).toHaveLength(2);
  });
});
