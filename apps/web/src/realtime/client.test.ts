import { CLOSE_CODES, type ServerMessage } from '@zubatto-quiz/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeRoomServer } from '../../test/fake-room-server';
import { connectRoom, playerHello, type ConnectionStatus, type RoomClientOptions } from './client';

const URL = 'ws://localhost/api/rooms/room-1/ws/play';
const TOKEN = 'A'.repeat(43);
/** random を0にすると、待ち時間は 250ms・500ms・1000ms… と決まる */
const FIRST_DELAY = 250;

function connect(options: Partial<RoomClientOptions> = {}) {
  const server = new FakeRoomServer();
  const messages: ServerMessage[] = [];
  const statuses: ConnectionStatus[] = [];
  const client = connectRoom({
    url: URL,
    createSocket: server.createSocket,
    onMessage: (m) => messages.push(m),
    onStatus: (status) => statuses.push(status),
    random: () => 0,
    ...options,
  });
  server.latest.open();
  return { server, client, messages, statuses };
}

const ROOM = { title: 'テスト', questionCount: 3, phase: 'lobby', questionIndex: null } as const;
const PARTICIPANT_ID = '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e6f';

describe('受け取ったメッセージ（ADR 0001）', () => {
  it.each([
    ['JSON でない', 'not json'],
    ['知らない type', JSON.stringify({ type: 'unknown' })],
    ['項目が足りない', JSON.stringify({ type: 'participants' })],
    ['項目の型が違う', JSON.stringify({ type: 'error', code: 'no_such_code' })],
  ])('%s メッセージは捨てる', (_, data) => {
    const { server, messages } = connect();

    server.latest.emitRaw(data);

    expect(messages).toEqual([]);
  });

  it('仕様どおりのメッセージは渡し、仕様にない項目は取り除く', () => {
    const { server, messages } = connect();

    server.latest.emitRaw(JSON.stringify({ type: 'error', code: 'not_accepting', correctIndex: 0 }));

    expect(messages).toEqual([{ type: 'error', code: 'not_accepting' }]);
  });
});

describe('切れたときのつなぎ直し（A1・F19・ADR 0001）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('回線が切れたら、待ち時間のあとにつなぎ直す', () => {
    const { server, statuses } = connect();

    server.latest.closeFromServer(1006);
    vi.advanceTimersByTime(FIRST_DELAY - 1);
    expect(server.sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(server.sockets).toHaveLength(2);
    server.latest.open();

    expect(statuses).toEqual(['open', 'reconnecting', 'open']);
  });

  it('つなげないあいだは、試すたびに待ち時間を延ばす', () => {
    const { server } = connect();

    server.latest.closeFromServer(1006);
    vi.advanceTimersByTime(FIRST_DELAY);
    server.latest.closeFromServer(1006);
    vi.advanceTimersByTime(FIRST_DELAY * 2 - 1);
    expect(server.sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(server.sockets).toHaveLength(3);
  });

  it('つなぎ直したら、保存した秘密で resume を送る', () => {
    const { server } = connect({ hello: playerHello({ name: 'たろう', token: TOKEN }) });
    expect(server.latest.received).toEqual([{ type: 'join', name: 'たろう', token: TOKEN }]);
    server.latest.emit({ type: 'joined', participantId: PARTICIPANT_ID, room: ROOM });

    server.latest.closeFromServer(1006);
    vi.advanceTimersByTime(FIRST_DELAY);
    server.latest.open();

    expect(server.latest.received).toEqual([{ type: 'resume', token: TOKEN }]);
  });

  it('名前を渡さなければ、初めから resume を送る（リロードしたとき）', () => {
    const { server } = connect({ hello: playerHello({ token: TOKEN }) });

    expect(server.latest.received).toEqual([{ type: 'resume', token: TOKEN }]);
  });

  it('close() のあとは、切れてもつなぎ直さない', () => {
    const { server, client } = connect();

    client.close();
    vi.runAllTimers();

    expect(server.sockets).toHaveLength(1);
  });
});

describe('サーバーに断られたとき（ADR 0004）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 上限を超えた接続は、いったん開いてから 4503 で閉じられる */
  function refuse(server: FakeRoomServer) {
    server.latest.open();
    server.latest.closeFromServer(CLOSE_CODES.connection_limit, 'connection_limit');
  }

  it('接続の上限で断られたら、開いてから閉じられても、断られるたびに待ち時間を延ばす', () => {
    const { server } = connect();
    server.latest.closeFromServer(CLOSE_CODES.connection_limit, 'connection_limit');
    vi.advanceTimersByTime(FIRST_DELAY);
    refuse(server);

    vi.advanceTimersByTime(FIRST_DELAY * 2 - 1);
    expect(server.sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(server.sockets).toHaveLength(3);
  });

  it('部屋に受け入れられたら（joined）、待ち時間を最初に戻す', () => {
    const { server } = connect({ hello: playerHello({ token: TOKEN }) });
    server.latest.closeFromServer(CLOSE_CODES.connection_limit);
    vi.advanceTimersByTime(FIRST_DELAY);
    refuse(server);
    vi.advanceTimersByTime(FIRST_DELAY * 2);
    server.latest.open();
    server.latest.emit({ type: 'resumed', participantId: PARTICIPANT_ID, name: 'たろう', score: 0, room: ROOM });

    server.latest.closeFromServer(1006);
    vi.advanceTimersByTime(FIRST_DELAY);

    expect(server.sockets).toHaveLength(4);
  });

  it('「別のタブ」の理由で閉じられたら、つなぎ直さずに止まる', () => {
    const closed: (number | undefined)[] = [];
    const { server } = connect({
      onStatus: (status, code) => {
        if (status === 'closed') closed.push(code);
      },
    });

    server.latest.closeFromServer(CLOSE_CODES.replaced, 'replaced');
    vi.runAllTimers();

    expect(server.sockets).toHaveLength(1);
    expect(closed).toEqual([CLOSE_CODES.replaced]);
  });
});
