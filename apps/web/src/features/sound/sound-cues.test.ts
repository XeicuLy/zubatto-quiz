import type { MyResult, RoomSnapshot, ServerMessage } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { createSoundCues, type SoundCue } from './sound-cues';

const ME = '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e6f';

function snapshot(phase: RoomSnapshot['phase'], questionIndex: number | null): RoomSnapshot {
  return { title: 'テスト', questionCount: 5, phase, questionIndex };
}

function hostReady(phase: RoomSnapshot['phase'], questionIndex: number | null): ServerMessage {
  return { type: 'hostReady', room: snapshot(phase, questionIndex) };
}

function questionShown(index: number): ServerMessage {
  return {
    type: 'questionShown',
    questionId: `q-${index}`,
    questionIndex: index,
    questionCount: 5,
    text: `問題${index}`,
    limitMs: 10_000,
  };
}

function answeringStarted(index: number): ServerMessage {
  return { type: 'answeringStarted', questionId: `q-${index}`, choices: ['A', 'B'], limitMs: 10_000, remainingMs: 0 };
}

function revealed(index: number): ServerMessage {
  return {
    type: 'revealed',
    questionId: `q-${index}`,
    correctIndex: 1,
    choiceCounts: [1, 2],
    answeredCount: 3,
    participantCount: 4,
  };
}

function myResult(index: number, answer: MyResult['answer'], correct: boolean): ServerMessage {
  return {
    type: 'myResult',
    questionId: `q-${index}`,
    correctIndex: 1,
    answer,
    correct,
    points: correct ? 1_000 : 0,
    bonusPoints: 0,
    totalScore: correct ? 1_000 : 0,
    remainingMaxPoints: 4_800,
    position: { kind: 'leader', rankUp: 0, leadOverNext: null },
  };
}

function fastest(index: number): ServerMessage {
  return {
    type: 'fastest',
    questionId: `q-${index}`,
    correctIndex: 1,
    fastest: [],
    correctCount: 0,
    answeredCount: 0,
    ranksHidden: false,
    biggestClimber: null,
  };
}

/** messages を1つの接続で順に受け取ったときの、メッセージごとの音 */
function cuesFor(...messages: ServerMessage[]): (readonly SoundCue[])[] {
  const cues = createSoundCues();
  return messages.map((message) => cues.next(message));
}

describe('ふだんの進行で鳴らす音（F18）', () => {
  it('出題で出題の音を鳴らし、受付開始では鳴らさない', () => {
    expect(cuesFor(hostReady('lobby', null), questionShown(0), answeringStarted(0))).toEqual([[], ['question'], []]);
  });

  it('ホストは ① で、締切の音のあとに正解発表の音を鳴らす', () => {
    expect(cuesFor(hostReady('lobby', null), questionShown(0), answeringStarted(0), revealed(0)).at(-1)).toEqual([
      'closed',
      'reveal',
    ]);
  });

  it.each<[string, MyResult['answer'], boolean, readonly SoundCue[]]>([
    ['正解した', { choiceIndex: 1, elapsedMs: 1_230 }, true, ['closed', 'correct']],
    ['間違えた', { choiceIndex: 0, elapsedMs: 1_230 }, false, ['closed', 'incorrect']],
    ['答えなかった', null, false, ['closed']],
  ])('%s回答者は ① で、締切の音のあとに %j を鳴らす', (_, answer, correct, expected) => {
    const join: ServerMessage = { type: 'joined', participantId: ME, room: snapshot('lobby', null) };

    expect(cuesFor(join, questionShown(0), answeringStarted(0), myResult(0, answer, correct)).at(-1)).toEqual(expected);
  });

  it('② から後と最終ランキング、参加者一覧などでは鳴らさない', () => {
    const cues = cuesFor(hostReady('lobby', null), questionShown(0), answeringStarted(0), revealed(0), fastest(0), {
      type: 'finalRanking',
      questionCount: 1,
      entries: [],
    });

    expect(cues.slice(4)).toEqual([[], []]);
    expect(cuesFor({ type: 'participants', participants: [] })).toEqual([[]]);
  });

  it('問題をやり直すと、同じ問題の出題の音をもう一度鳴らす', () => {
    expect(cuesFor(hostReady('lobby', null), questionShown(0), answeringStarted(0), questionShown(0)).at(-1)).toEqual([
      'question',
    ]);
  });
});

describe('つなぎ直したときの送り直しでは鳴らさない（A1）', () => {
  it('締切のあとにつなぎ直すと、送り直された出題・受付開始・① で鳴らさず、次の出題から鳴らす', () => {
    expect(
      cuesFor(hostReady('revealed', 2), questionShown(2), answeringStarted(2), revealed(2), questionShown(3)),
    ).toEqual([[], [], [], [], ['question']]);
  });

  it('受付中に入り直した回答者は、送り直された出題で鳴らさず、そのあとの ① で鳴らす', () => {
    const resume: ServerMessage = {
      type: 'resumed',
      participantId: ME,
      name: 'たろう',
      score: 0,
      room: snapshot('accepting', 1),
    };

    expect(
      cuesFor(resume, questionShown(1), answeringStarted(1), myResult(1, { choiceIndex: 1, elapsedMs: 900 }, true)),
    ).toEqual([[], [], [], ['closed', 'correct']]);
  });

  it('出題のあいだに入った回答者は、送り直された出題で鳴らさず、やり直しの出題では鳴らす', () => {
    const join: ServerMessage = { type: 'joined', participantId: ME, room: snapshot('question', 0) };

    expect(cuesFor(join, questionShown(0), questionShown(0))).toEqual([[], [], ['question']]);
  });

  it('送り直しが今の段階まで届かなくても、次の問題の出題では鳴らす', () => {
    expect(cuesFor(hostReady('fastest', 1), questionShown(1), answeringStarted(1), questionShown(2))).toEqual([
      [],
      [],
      [],
      ['question'],
    ]);
  });
});
