import type { HostCommand, RoomPhase, RoomSnapshot } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { changesStage, forwardCommandsOf } from './host-commands';

/** 5問の部屋。最後の2問は第4問と第5問（questionIndex 3 と 4） */
const room = (phase: RoomPhase, questionIndex: number | null): RoomSnapshot => ({
  title: '内輪クイズ',
  questionCount: 5,
  phase,
  questionIndex,
});

describe('forwardCommandsOf: 今の段階で押せる、進む操作（F8・F14・F15）', () => {
  it.each<[string, RoomSnapshot, HostCommand[]]>([
    ['待機', room('lobby', null), [{ type: 'showQuestion', questionIndex: 0 }]],
    ['出題（F8: 受付は別に始める）', room('question', 0), [{ type: 'startAnswering', questionIndex: 0 }]],
    ['受付中', room('accepting', 0), [{ type: 'closeAnswering', questionIndex: 0 }]],
    ['① のあとは ② だけ', room('revealed', 0), [{ type: 'revealFastest', questionIndex: 0 }]],
    [
      '② のあとは ③ か次の問題',
      room('fastest', 0),
      [
        { type: 'showStandings', questionIndex: 0 },
        { type: 'showQuestion', questionIndex: 1 },
      ],
    ],
    ['③ のあとは次の問題', room('standings', 2), [{ type: 'showQuestion', questionIndex: 3 }]],
    ['最後から2問目の ② は ③ を出さない（F15）', room('fastest', 3), [{ type: 'showQuestion', questionIndex: 4 }]],
    ['最後の問題の ② のあとに押せる操作は、最終ランキングだけ', room('fastest', 4), [{ type: 'showFinalRanking' }]],
    ['最終ランキングのあとは、進む操作がない', room('final', 4), []],
  ])('%s', (_case, snapshot, expected) => {
    expect(forwardCommandsOf(snapshot)).toEqual(expected);
  });
});

describe('changesStage: 送ったら段階か問題が変わるか（ホストの操作のあとのフォーカス）', () => {
  it.each<[string, RoomSnapshot, HostCommand, boolean]>([
    ['第1問を出す', room('lobby', null), { type: 'showQuestion', questionIndex: 0 }, true],
    ['受付を始める', room('question', 0), { type: 'startAnswering', questionIndex: 0 }, true],
    ['② のあとの次の問題', room('fastest', 0), { type: 'showQuestion', questionIndex: 1 }, true],
    ['受付中のやり直しは出題に戻る', room('accepting', 0), { type: 'retryQuestion', questionIndex: 0 }, true],
    ['出題中のやり直しは同じ段階のまま', room('question', 0), { type: 'retryQuestion', questionIndex: 0 }, false],
    ['部屋を終えても段階は変わらない', room('accepting', 0), { type: 'endRoom' }, false],
    ['今は送れない操作', room('question', 0), { type: 'closeAnswering', questionIndex: 0 }, false],
  ])('%s', (_case, snapshot, command, expected) => {
    expect(changesStage(snapshot, command)).toBe(expected);
  });
});
