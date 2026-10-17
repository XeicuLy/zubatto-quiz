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

describe('進行の操作（T32）', () => {
  const QUESTION = {
    type: 'questionShown',
    questionId: 'q-1',
    questionIndex: 0,
    questionCount: 3,
    text: '第1問',
    limitMs: 10_000,
  } as const;
  const answeringStarted = (remainingMs: number) => ({
    type: 'answeringStarted' as const,
    questionId: 'q-1',
    choices: ['A', 'B'],
    limitMs: 10_000,
    remainingMs,
  });

  /** 第1問の受付が始まったところまで進める */
  function startAccepting(remainingMs = 10_000) {
    const context = setup();
    context.host.connect();
    context.server.latest.open();
    context.server.latest.emit({ type: 'hostReady', room: ROOM });
    context.server.latest.emit(QUESTION);
    context.server.latest.emit(answeringStarted(remainingMs));
    return context;
  }

  const closeCommands = (server: FakeRoomServer) =>
    server.sockets.flatMap((socket) => socket.received).filter((message) => message.type === 'closeAnswering');

  it('send で進行の操作を送る', () => {
    const { server, host } = setup();
    host.connect();
    server.latest.open();

    expect(host.send({ type: 'showQuestion', questionIndex: 0 })).toBe(true);
    expect(server.latest.received).toEqual([{ type: 'showQuestion', questionIndex: 0 }]);
  });

  it('接続が開いていなければ送らずに false を返す', () => {
    const { host } = setup();
    host.connect();

    expect(host.send({ type: 'showQuestion', questionIndex: 0 })).toBe(false);
  });

  it('残りが0になったら、部屋の DO の alarm を待たずに締切を送る', () => {
    const { server } = startAccepting();

    vi.advanceTimersByTime(9_999);
    expect(closeCommands(server)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(closeCommands(server)).toEqual([{ type: 'closeAnswering', questionIndex: 0 }]);
  });

  it('先に締め切られていたら（① が届いた）、締切を送らない', () => {
    const { server } = startAccepting();

    server.latest.emit({
      type: 'revealed',
      questionId: 'q-1',
      correctIndex: 0,
      choiceCounts: [0, 0],
      answeredCount: 0,
      participantCount: 0,
    });
    vi.advanceTimersByTime(10_000);

    expect(closeCommands(server)).toEqual([]);
  });

  it('受付中にやり直したら（出題に戻った）、締切を送らない（A3）', () => {
    const { server } = startAccepting();

    vi.advanceTimersByTime(4_000);
    server.latest.emit(QUESTION);
    vi.advanceTimersByTime(6_000);

    expect(closeCommands(server)).toEqual([]);
  });

  it('やり直したあとの受付開始を受け取る前に切れたら、前の受付のタイマーで締め切らない', () => {
    const { server } = startAccepting();

    // 4秒でやり直し、6秒で受付を始め直す。DO の新しい締切は16秒だが、answeringStarted が届く前に切れる
    vi.advanceTimersByTime(4_000);
    server.latest.emit(QUESTION);
    vi.advanceTimersByTime(2_000);
    server.latest.closeFromServer(1006);
    // つなぎ直しの待ち時間（最初は0.5秒以内）のあとに開き直し、hostReady で受付中に戻る
    vi.advanceTimersByTime(1_000);
    server.latest.open();
    server.latest.emit({ type: 'hostReady', room: { ...ROOM, phase: 'accepting', questionIndex: 0 } });
    // 前の受付のタイマー（10秒）を過ぎても、送り直しの answeringStarted を待つ
    vi.advanceTimersByTime(5_000);

    expect(closeCommands(server)).toEqual([]);
  });

  it('つなぎ直して残りが送り直されたら、その残りで1回だけ送る', () => {
    const { server } = startAccepting();

    vi.advanceTimersByTime(3_000);
    server.latest.closeFromServer(1006);
    vi.advanceTimersByTime(1_000);
    server.latest.open();
    server.latest.emit({ type: 'hostReady', room: { ...ROOM, phase: 'accepting', questionIndex: 0 } });
    server.latest.emit(QUESTION);
    server.latest.emit(answeringStarted(2_000));

    vi.advanceTimersByTime(1_999);
    expect(closeCommands(server)).toEqual([]);
    vi.advanceTimersByTime(10_000);
    expect(closeCommands(server)).toEqual([{ type: 'closeAnswering', questionIndex: 0 }]);
  });
});
