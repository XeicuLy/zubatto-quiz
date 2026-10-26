import type { HostCommand, RoomPhase, RoomSnapshot } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { forwardCommandsOf, settleFocus, type Stage, stageAfter } from './host-commands';

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

describe('stageAfter: 送った操作が通ったら移る段階（ホストの操作のあとのフォーカス）', () => {
  it.each<[string, RoomSnapshot, HostCommand, Stage | null]>([
    [
      '第1問を出す',
      room('lobby', null),
      { type: 'showQuestion', questionIndex: 0 },
      { phase: 'question', questionIndex: 0 },
    ],
    [
      '受付を始める',
      room('question', 0),
      { type: 'startAnswering', questionIndex: 0 },
      { phase: 'accepting', questionIndex: 0 },
    ],
    [
      '② のあとの次の問題',
      room('fastest', 0),
      { type: 'showQuestion', questionIndex: 1 },
      { phase: 'question', questionIndex: 1 },
    ],
    [
      '最終ランキングは問題番号を変えない',
      room('fastest', 4),
      { type: 'showFinalRanking' },
      { phase: 'final', questionIndex: 4 },
    ],
    [
      '受付中のやり直しは出題に戻る',
      room('accepting', 0),
      { type: 'retryQuestion', questionIndex: 0 },
      { phase: 'question', questionIndex: 0 },
    ],
    ['出題中のやり直しは同じ段階のまま', room('question', 0), { type: 'retryQuestion', questionIndex: 0 }, null],
    ['部屋を終えても段階は変わらない', room('accepting', 0), { type: 'endRoom' }, null],
    ['今は送れない操作', room('question', 0), { type: 'closeAnswering', questionIndex: 0 }, null],
  ])('%s', (_case, snapshot, command, expected) => {
    expect(stageAfter(snapshot, command)).toEqual(expected);
  });
});

describe('settleFocus: 段階が変わったときの、フォーカスの予約の始末', () => {
  const standings: Stage = { phase: 'standings', questionIndex: 0 };
  const next: Stage = { phase: 'question', questionIndex: 1 };

  it.each<[string, Stage[], Stage, { focus: boolean; rest: Stage[] }]>([
    ['予約がない（アラームの締切・別のタブ）', [], standings, { focus: false, rest: [] }],
    ['行き先と一致したら使う', [standings], standings, { focus: true, rest: [] }],
    ['続けて送った後の予約は、次の段階のために残す', [standings, next], standings, { focus: true, rest: [next] }],
    ['2つの段階が1回の描画にまとまって届いたら、後の予約で使う', [standings, next], next, { focus: true, rest: [] }],
    ['同じ操作を2回送った予約は、まとめて使う', [next, next], next, { focus: true, rest: [] }],
    [
      '一致しなければ、送った操作は断られているので全部捨てる',
      [{ phase: 'question', questionIndex: 0 }],
      { phase: 'revealed', questionIndex: 0 },
      { focus: false, rest: [] },
    ],
  ])('%s', (_case, pending, stage, expected) => {
    expect(settleFocus(pending, stage)).toEqual(expected);
  });
});
