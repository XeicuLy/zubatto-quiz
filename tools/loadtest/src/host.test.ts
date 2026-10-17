import { questionSetSchema } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { closeTimingOf, loadtestQuestionSet, roomSocketUrl } from './host.ts';

const ROOM_ID = 'a'.repeat(64);

describe('roomSocketUrl', () => {
  it.each([
    ['https://zubakui.example.workers.dev', 'host', `wss://zubakui.example.workers.dev/api/rooms/${ROOM_ID}/ws/host`],
    ['http://localhost:4173', 'play', `ws://localhost:4173/api/rooms/${ROOM_ID}/ws/play`],
  ] as const)('%s の %s の入口', (origin, entry, expected) => {
    expect(roomSocketUrl(origin, ROOM_ID, entry)).toBe(expected);
  });
});

describe('loadtestQuestionSet', () => {
  it('指定した問題の数と制限時間で、protocol のスキーマに通るセットを作る', () => {
    const set = loadtestQuestionSet(3, 10_000);
    expect(questionSetSchema.parse(set).questions).toHaveLength(3);
    expect(set.questions.every((question) => question.limitMs === 10_000)).toBe(true);
  });

  it('F9 の範囲の外の制限時間では作らない', () => {
    expect(() => loadtestQuestionSet(1, 4_000)).toThrow('>=5000');
  });
});

describe('closeTimingOf', () => {
  it.each([
    // [revealed が届いた時刻（届かなければ null）, closeAnswering を送った時刻, 期待]
    [1_030, 1_000, 'measured'],
    // 送ったのと同じ時刻に届いたものは、送ったあとに届いたものとして測る
    [1_000, 1_000, 'measured'],
    // 10秒待っても届かない。P4 の遅れか取りこぼしで、alarm のせいではない
    [null, 1_000, 'not_revealed'],
    // 送る前に alarm が締め切っていた
    [990, 1_000, 'alarm_first'],
  ] as const)('revealed が %s、締切が %d なら %s', (revealedAt, closedAt, expected) => {
    expect(closeTimingOf(revealedAt, closedAt)).toBe(expected);
  });
});
