import { describe, expect, it } from 'vitest';

import { roomSocketUrl } from './room-url';

const ROOM_ID = 'a'.repeat(64);

describe('部屋の WebSocket の URL', () => {
  it.each([
    ['http://localhost:5173/r/x', 'play', `ws://localhost:5173/api/rooms/${ROOM_ID}/ws/play`],
    ['https://zubakui.example/r/x', 'play', `wss://zubakui.example/api/rooms/${ROOM_ID}/ws/play`],
    ['https://zubakui.example/rooms/x/host', 'host', `wss://zubakui.example/api/rooms/${ROOM_ID}/ws/host`],
  ] as const)('%s の画面から %s の入口へは %s', (page, entry, expected) => {
    expect(roomSocketUrl(ROOM_ID, entry, new URL(page))).toBe(expected);
  });

  it('ページのクエリやハッシュは持ち込まない', () => {
    expect(roomSocketUrl(ROOM_ID, 'play', new URL('https://zubakui.example/r/x?a=1#b'))).toBe(
      `wss://zubakui.example/api/rooms/${ROOM_ID}/ws/play`,
    );
  });
});
