import type { FinalRanking, RoomSnapshot } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import type { ConnectionStatus } from '../../realtime/client';
import { roomEndOf } from './room-end';

const roomAt = (phase: RoomSnapshot['phase']): RoomSnapshot => ({
  title: '内輪クイズ',
  questionCount: 3,
  phase,
  questionIndex: phase === 'lobby' ? null : 2,
});
const RANKING: FinalRanking = {
  type: 'finalRanking',
  questionCount: 3,
  entries: [{ participantId: '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e61', name: 'たろう', rank: 1, totalScore: 2900 }],
};
const ended = { connection: 'closed', closeReason: 'room_ended' } as const;

describe('部屋が終わったときの段階（#97）', () => {
  it.each([
    ['最終ランキングのあとに終えた', 'after_final', roomAt('final'), RANKING],
    ['待機中に終えた', 'midway', roomAt('lobby'), null],
    ['受付中に終えた', 'midway', roomAt('accepting'), null],
    ['途中経過のあとに終えた', 'midway', roomAt('standings'), null],
    // final の送り直しが届く前に閉じたら、手元に残せる最終ランキングはない
    ['final で最終ランキングがまだ届いていない', 'midway', roomAt('final'), null],
    ['終わった部屋に入ろうとして断られた', 'not_entered', null, null],
  ] as const)('%s → %s', (_, expected, room, finalRanking) => {
    expect(roomEndOf({ ...ended, room, finalRanking })).toBe(expected);
  });

  it.each([
    ['open', null],
    ['reconnecting', null],
    ['closed', 'replaced'],
    ['closed', 'room_not_found'],
    ['closed', null],
  ] as const satisfies readonly (readonly [ConnectionStatus, unknown])[])(
    '%s・%s のときは、部屋が終わったことにしない',
    (connection, closeReason) => {
      expect(roomEndOf({ connection, closeReason, room: roomAt('final'), finalRanking: RANKING })).toBeNull();
    },
  );
});
