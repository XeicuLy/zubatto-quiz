import { describe, expect, it } from 'vitest';

import { canSend, canShowStandings, transition, type RoomFlowState } from './room-flow.ts';
import type { HostCommand } from './ws/client-messages.ts';
import type { RoomPhase, RoomSnapshot } from './ws/server-messages.ts';

/** 5問の部屋。最後の2問は 3 と 4 */
const QUESTION_COUNT = 5;

const lobby: RoomFlowState = { phase: 'lobby', questionIndex: null, ended: false };
const at = (phase: RoomPhase, questionIndex: number): RoomFlowState => ({ phase, questionIndex, ended: false });
const ended = (state: RoomFlowState): RoomFlowState => ({ ...state, ended: true });

const showQuestion = (questionIndex: number): HostCommand => ({ type: 'showQuestion', questionIndex });
const startAnswering = (questionIndex: number): HostCommand => ({ type: 'startAnswering', questionIndex });
const closeAnswering = (questionIndex: number): HostCommand => ({ type: 'closeAnswering', questionIndex });
const revealFastest = (questionIndex: number): HostCommand => ({ type: 'revealFastest', questionIndex });
const showStandings = (questionIndex: number): HostCommand => ({ type: 'showStandings', questionIndex });
const retryQuestion = (questionIndex: number): HostCommand => ({ type: 'retryQuestion', questionIndex });
const showFinalRanking: HostCommand = { type: 'showFinalRanking' };
const endRoom: HostCommand = { type: 'endRoom' };

describe('transition: 進行の状態の移り変わり（F8・F14・F15）', () => {
  it.each<[string, RoomFlowState, HostCommand, RoomFlowState]>([
    ['待機から第1問を出す', lobby, showQuestion(0), at('question', 0)],
    ['出題のあとに受付を始める（F8）', at('question', 0), startAnswering(0), at('accepting', 0)],
    ['受付中に締め切る', at('accepting', 0), closeAnswering(0), at('revealed', 0)],
    ['① のあとに ② を出す', at('revealed', 0), revealFastest(0), at('fastest', 0)],
    ['② のあとに ③ を出す', at('fastest', 0), showStandings(0), at('standings', 0)],
    ['② のあとに次の問題を出す（③ はなくてもよい）', at('fastest', 0), showQuestion(1), at('question', 1)],
    ['③ のあとに次の問題を出す', at('standings', 2), showQuestion(3), at('question', 3)],
    ['出題中の問題をやり直す（A3）', at('question', 2), retryQuestion(2), at('question', 2)],
    ['受付中の問題をやり直す（A3）', at('accepting', 2), retryQuestion(2), at('question', 2)],
    ['最後の問題の ② のあとに最終ランキングを出す', at('fastest', 4), showFinalRanking, at('final', 4)],
    ['受付中でも部屋を終えられる', at('accepting', 1), endRoom, ended(at('accepting', 1))],
    ['最終ランキングのあとに部屋を終える', at('final', 4), endRoom, ended(at('final', 4))],
  ])('%s', (_case, state, command, next) => {
    expect(transition(state, command, QUESTION_COUNT)).toEqual({ ok: true, next });
  });

  it.each<[string, RoomFlowState, HostCommand]>([
    ['待機から第2問を出す（問題を飛ばす）', lobby, showQuestion(1)],
    ['出題の前に受付を始める', lobby, startAnswering(0)],
    ['受付を始める前に締め切る', at('question', 0), closeAnswering(0)],
    ['受付開始の2度押し', at('accepting', 0), startAnswering(0)],
    ['今の問題と違う番号の受付開始', at('question', 0), startAnswering(1)],
    ['① から ② を飛ばして次の問題を出す（F14）', at('revealed', 0), showQuestion(1)],
    ['① から ② を飛ばして ③ を出す', at('revealed', 0), showStandings(0)],
    ['③ から ② へ戻る', at('standings', 0), revealFastest(0)],
    ['② から問題を1つ飛ばす', at('fastest', 0), showQuestion(2)],
    ['最後の問題のあとに次の問題を出す', at('fastest', 4), showQuestion(5)],
    ['最後でない問題のあとに最終ランキングを出す', at('fastest', 3), showFinalRanking],
    ['最後の問題の ② の前に最終ランキングを出す', at('revealed', 4), showFinalRanking],
    ['締切のあとにやり直す（得点は確定している）', at('revealed', 0), retryQuestion(0)],
    ['最後から2問目で ③ を出す（F15）', at('fastest', 3), showStandings(3)],
    ['最後の問題で ③ を出す（F15）', at('fastest', 4), showStandings(4)],
    ['終えた部屋で問題を出す', ended(at('fastest', 0)), showQuestion(1)],
    ['終えた部屋をもう一度終える', ended(lobby), endRoom],
  ])('%s は断る', (_case, state, command) => {
    expect(transition(state, command, QUESTION_COUNT)).toEqual({ ok: false });
  });
});

describe('canShowStandings: ③ 途中経過を出せるか（F15）', () => {
  it.each<[number, number, boolean]>([
    // [何問目か（0始まり）, 問題の数, 出せるか]
    [0, 5, true],
    [2, 5, true],
    [3, 5, false],
    [4, 5, false],
    [0, 2, false],
    [1, 2, false],
  ])('%i 問目（0始まり）・全 %i 問 → %s', (questionIndex, questionCount, expected) => {
    expect(canShowStandings(questionIndex, questionCount)).toBe(expected);
  });
});

describe('canSend: 進行画面のボタンを押せるか（T32）', () => {
  const snapshot = (phase: RoomPhase, questionIndex: number | null): RoomSnapshot => ({
    title: '内輪クイズ',
    questionCount: QUESTION_COUNT,
    phase,
    questionIndex,
  });

  it.each<[string, RoomSnapshot, HostCommand, boolean]>([
    ['待機で第1問を出す', snapshot('lobby', null), showQuestion(0), true],
    ['出題のあいだに受付を始める（F8）', snapshot('question', 0), startAnswering(0), true],
    ['出題のあいだに締め切る', snapshot('question', 0), closeAnswering(0), false],
    ['受付中にやり直す（A3）', snapshot('accepting', 1), retryQuestion(1), true],
    ['① でやり直す', snapshot('revealed', 1), retryQuestion(1), false],
    ['最後から2問目の ② で ③ を出す（F15）', snapshot('fastest', 3), showStandings(3), false],
    ['最終ランキングで部屋を終える', snapshot('final', 4), endRoom, true],
  ])('%s → %s', (_case, room, command, expected) => {
    expect(canSend(room, command)).toBe(expected);
  });
});
