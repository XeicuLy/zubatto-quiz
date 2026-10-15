import { CLOSE_CODES, type CloseReason } from '@zubatto-quiz/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeRoomServer } from '../../../test/fake-room-server';
import { createPlayerRoom, rejectionOf, type PlayerEntry } from './player-room';
import { createToken, loadToken, saveToken } from './token-storage';

const ROOM_ID = 'a'.repeat(64);
const URL = `ws://localhost/api/rooms/${ROOM_ID}/ws/play`;
const ROOM = { title: 'テスト', questionCount: 3, phase: 'lobby', questionIndex: null } as const;
const PARTICIPANT_ID = '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e6f';

function setup() {
  const server = new FakeRoomServer();
  const player = createPlayerRoom({ roomId: ROOM_ID, url: URL, createSocket: server.createSocket });
  const entry = () => player.store.getState().entry;
  return { server, player, entry };
}

/** 部屋の中の画面のときだけ、その store を返す */
function roomOf(entry: PlayerEntry) {
  if (entry.screen !== 'room') {
    throw new Error(`部屋の中の画面ではない: ${entry.screen}`);
  }
  return entry;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('入室（F2・ADR 0004）', () => {
  it('保存した秘密がなければ、名前の入力から始め、接続を開かない', () => {
    const { server, player, entry } = setup();

    player.resumeSaved();

    expect(entry()).toEqual({ screen: 'form', notice: null, name: '' });
    expect(server.sockets).toHaveLength(0);
  });

  it('名前を入れたら、秘密を保存してから接続を開き、join で送る', () => {
    const { server, player, entry } = setup();

    player.join('たろう');
    const token = loadToken(ROOM_ID);
    server.latest.open();

    expect(token).not.toBeNull();
    expect(server.sockets).toHaveLength(1);
    expect(server.latest.received).toEqual([{ type: 'join', name: 'たろう', token }]);
    expect(entry()).toMatchObject({ screen: 'room', name: 'たろう', persisted: true });
  });

  it('保存した秘密があれば、名前を聞かずに resume で入る', () => {
    const token = createToken();
    saveToken(ROOM_ID, token);
    const { server, player, entry } = setup();

    player.resumeSaved();
    server.latest.open();

    expect(server.latest.received).toEqual([{ type: 'resume', token }]);
    expect(entry()).toMatchObject({ screen: 'room', name: null, persisted: true });
  });

  it('届いたメッセージを部屋の store に写す', () => {
    const { server, player, entry } = setup();

    player.join('たろう');
    server.latest.open();
    server.latest.emit({ type: 'joined', participantId: PARTICIPANT_ID, room: ROOM });
    server.latest.emit({ type: 'participants', participants: [{ participantId: PARTICIPANT_ID, name: 'たろう' }] });

    const room = roomOf(entry()).room.getState();
    expect(room.room).toEqual(ROOM);
    expect(room.participants).toEqual([{ participantId: PARTICIPANT_ID, name: 'たろう' }]);
  });

  it('join の返事の前に切れても、同じ秘密の resume でつなぎ直す', async () => {
    const { server, player } = setup();

    player.join('たろう');
    const token = loadToken(ROOM_ID);
    server.latest.open();
    server.latest.closeFromServer(1006);
    await vi.runOnlyPendingTimersAsync();
    server.latest.open();

    expect(server.sockets).toHaveLength(2);
    expect(server.latest.received).toEqual([{ type: 'resume', token }]);
  });
});

describe('断られたとき（ADR 0004）', () => {
  it('resume に失敗したら、秘密を消して名前の入力に戻り、つなぎ直さない', async () => {
    const { server, player, entry } = setup();

    player.join('たろう');
    server.latest.open();
    server.latest.closeFromServer(1006);
    await vi.runOnlyPendingTimersAsync();
    server.latest.open();
    server.latest.closeFromServer(CLOSE_CODES.resume_failed);
    await vi.runOnlyPendingTimersAsync();

    expect(loadToken(ROOM_ID)).toBeNull();
    expect(entry()).toEqual({ screen: 'form', notice: 'resume_failed', name: 'たろう' });
    expect(server.sockets).toHaveLength(2);
  });

  it('名前がかぶったら、秘密を消して名前の入力に戻る。入れ直すと新しい秘密で join する', () => {
    const { server, player, entry } = setup();

    player.join('たろう');
    const first = loadToken(ROOM_ID);
    server.latest.open();
    server.latest.closeFromServer(CLOSE_CODES.name_taken);

    expect(loadToken(ROOM_ID)).toBeNull();
    expect(entry()).toEqual({ screen: 'form', notice: 'name_taken', name: 'たろう' });

    player.join('じろう');
    server.latest.open();

    const second = loadToken(ROOM_ID);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(server.latest.received).toEqual([{ type: 'join', name: 'じろう', token: second }]);
    // 入り直すたびに、部屋の store も新しくなる
    expect(roomOf(entry()).room.getState().connection).toBe('open');
  });

  it('満員なら、秘密を消して満員の画面にする', () => {
    const { server, player, entry } = setup();

    player.join('たろう');
    server.latest.open();
    server.latest.closeFromServer(CLOSE_CODES.room_full);

    expect(loadToken(ROOM_ID)).toBeNull();
    expect(entry()).toEqual({ screen: 'full' });
  });

  it.each([
    ['replaced', CLOSE_CODES.replaced],
    ['room_ended', CLOSE_CODES.room_ended],
  ] as const)('%s で閉じられたら、部屋の中の画面のまま理由を残し、つなぎ直さない', async (reason, code) => {
    const { server, player, entry } = setup();

    player.join('たろう');
    server.latest.open();
    server.latest.closeFromServer(code);
    await vi.runOnlyPendingTimersAsync();

    const room = roomOf(entry()).room.getState();
    expect(room.connection).toBe('closed');
    expect(room.closeReason).toBe(reason);
    expect(loadToken(ROOM_ID)).not.toBeNull();
    expect(server.sockets).toHaveLength(1);
  });
});

describe('閉じた理由のうち、秘密を消して入り直すもの', () => {
  it.each<[CloseReason | null, ReturnType<typeof rejectionOf>]>([
    ['name_taken', 'name_taken'],
    ['resume_failed', 'resume_failed'],
    ['room_full', 'room_full'],
    ['replaced', null],
    ['room_ended', null],
    ['join_timeout', null],
    ['connection_limit', null],
    [null, null],
  ])('%s → %s', (reason, expected) => {
    expect(rejectionOf(reason)).toBe(expected);
  });
});

describe('localStorage が使えないとき', () => {
  it('保存できなくても入室し、保存できなかったことを残す', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const { server, player, entry } = setup();

    player.join('たろう');
    server.latest.open();

    expect(server.latest.received).toMatchObject([{ type: 'join', name: 'たろう' }]);
    expect(entry()).toMatchObject({ screen: 'room', persisted: false });
  });
});

describe('秘密を外に出さない（ADR 0004）', () => {
  it('接続の URL にもログにも秘密が出ない', () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const { server, player } = setup();

    player.join('たろう');
    const token = loadToken(ROOM_ID)!;
    server.latest.open();
    server.latest.closeFromServer(CLOSE_CODES.name_taken);

    expect(server.sockets.map((socket) => socket.url)).toEqual([URL]);
    for (const log of logs) {
      expect(JSON.stringify(log.mock.calls)).not.toContain(token);
    }
  });
});

describe('部屋を離れるとき', () => {
  it('接続を閉じ、もうつなぎ直さない', async () => {
    const { server, player } = setup();

    player.join('たろう');
    server.latest.open();
    player.leave();
    await vi.runOnlyPendingTimersAsync();

    expect(server.latest.readyState).toBe(WebSocket.CLOSED);
    expect(server.sockets).toHaveLength(1);
  });
});
