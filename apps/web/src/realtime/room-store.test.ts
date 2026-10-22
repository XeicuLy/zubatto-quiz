import { CLOSE_CODES, type RoomSnapshot, type ServerMessage } from '@zubatto-quiz/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeRoomServer } from '../../test/fake-room-server';
import { connectRoom, playerHello } from './client';
import { applyServerMessage, createRoomStore, initialRoomState, type RoomState } from './room-store';

const ME = '6f1c1c2e-2b8a-4c55-9d5e-1a2b3c4d5e6f';
const OTHER = '0b7f1a3e-9c4d-4e2a-8f6b-7c5d4e3f2a1b';
const TOKEN = 'A'.repeat(43);

function snapshot(phase: RoomSnapshot['phase'], questionIndex: number | null): RoomSnapshot {
  return { title: 'テスト', questionCount: 3, phase, questionIndex };
}

function questionShown(index: number): ServerMessage {
  return {
    type: 'questionShown',
    questionId: `q-${index}`,
    questionIndex: index,
    questionCount: 3,
    text: `問題${index}`,
    limitMs: 10_000,
  };
}

function answeringStarted(index: number, remainingMs = 10_000): ServerMessage {
  return { type: 'answeringStarted', questionId: `q-${index}`, choices: ['A', 'B'], limitMs: 10_000, remainingMs };
}

/** messages を順に反映した状態 */
function stateAfter(...messages: ServerMessage[]): RoomState {
  return messages.reduce<RoomState>((state, m) => ({ ...state, ...applyServerMessage(state, m) }), initialRoomState);
}

describe('applyServerMessage', () => {
  it('joined で、部屋の状態と自分の participantId を持つ', () => {
    const state = stateAfter({ type: 'joined', participantId: ME, room: snapshot('lobby', null) });

    expect(state.room).toEqual(snapshot('lobby', null));
    expect(state.me).toEqual({ participantId: ME, name: null, score: 0 });
  });

  it('participants で、参加者の一覧を置き換える', () => {
    const state = stateAfter(
      { type: 'participants', participants: [{ participantId: ME, name: 'たろう' }] },
      {
        type: 'participants',
        participants: [
          { participantId: ME, name: 'たろう' },
          { participantId: OTHER, name: 'はなこ' },
        ],
      },
    );

    expect(state.participants.map((p) => p.name)).toEqual(['たろう', 'はなこ']);
  });

  it('出題で段階を question にし、選択肢はまだ持たない', () => {
    const state = stateAfter({ type: 'joined', participantId: ME, room: snapshot('lobby', null) }, questionShown(0));

    expect(state.room).toMatchObject({ phase: 'question', questionIndex: 0 });
    expect(state.question).toMatchObject({ questionId: 'q-0', text: '問題0', choices: null });
  });

  it('受付開始で段階を accepting にし、選択肢と残り時間を持つ', () => {
    const state = stateAfter(
      { type: 'joined', participantId: ME, room: snapshot('lobby', null) },
      questionShown(0),
      answeringStarted(0, 7_000),
    );

    expect(state.room?.phase).toBe('accepting');
    expect(state.question).toMatchObject({ choices: ['A', 'B'], remainingMs: 7_000 });
  });

  it('今の問題と違う問題へのメッセージは、遅れて届いたものとして無視する', () => {
    const before = stateAfter({ type: 'joined', participantId: ME, room: snapshot('lobby', null) }, questionShown(1));

    expect(applyServerMessage(before, answeringStarted(0))).toEqual({});
  });

  it('自分の結果で段階を revealed にし、合計の得点を更新する', () => {
    const state = stateAfter(
      { type: 'joined', participantId: ME, room: snapshot('lobby', null) },
      questionShown(0),
      answeringStarted(0),
      { type: 'answerAccepted', questionId: 'q-0', choiceIndex: 1, elapsedMs: 1_230 },
      {
        type: 'myResult',
        questionId: 'q-0',
        correctIndex: 1,
        answer: { choiceIndex: 1, elapsedMs: 1_230 },
        correct: true,
        points: 1_000,
        bonusPoints: 0,
        totalScore: 1_000,
        remainingMaxPoints: 2_400,
        position: { kind: 'leader', rankUp: 0, leadOverNext: null },
      },
    );

    expect(state.room?.phase).toBe('revealed');
    expect(state.me?.score).toBe(1_000);
    expect(state.question?.answer).toEqual({ choiceIndex: 1, elapsedMs: 1_230 });
    expect(state.question?.myResult?.correct).toBe(true);
  });

  it('最終ランキングで段階を final にする', () => {
    const state = stateAfter(
      { type: 'joined', participantId: ME, room: snapshot('fastest', 2) },
      {
        type: 'finalRanking',
        questionCount: 3,
        entries: [{ participantId: ME, name: 'たろう', rank: 1, totalScore: 10 }],
      },
    );

    expect(state.room?.phase).toBe('final');
    expect(state.finalRanking?.entries).toHaveLength(1);
  });

  it('resumed で、自分の名前と得点・部屋の状態を取り直し、別の問題の表示を消す', () => {
    const state = stateAfter({ type: 'joined', participantId: ME, room: snapshot('lobby', null) }, questionShown(0), {
      type: 'resumed',
      participantId: ME,
      name: 'たろう',
      score: 500,
      room: snapshot('accepting', 1),
    });

    expect(state.me).toEqual({ participantId: ME, name: 'たろう', score: 500 });
    expect(state.room).toEqual(snapshot('accepting', 1));
    expect(state.question).toBeNull();
  });

  it('error で、最後のエラーの code を持つ', () => {
    expect(stateAfter({ type: 'error', code: 'already_answered' }).lastError).toBe('already_answered');
  });
});

describe('接続の状態', () => {
  it('つなぎ直さずに閉じたら、code から理由を持つ', () => {
    const store = createRoomStore();

    store.getState().connectionChanged('closed', CLOSE_CODES.replaced);

    expect(store.getState()).toMatchObject({ connection: 'closed', closeReason: 'replaced' });
  });

  it('アプリの code でなければ、理由は持たない', () => {
    const store = createRoomStore();

    store.getState().connectionChanged('closed', 1006);

    expect(store.getState()).toMatchObject({ connection: 'closed', closeReason: null });
  });
});

describe('つなぎ直しから状態の取り直しまで（A1・F19・ADR 0001）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('切れたあと resume で戻り、部屋の DO が送り直した今の問題を出す', () => {
    const server = new FakeRoomServer();
    const store = createRoomStore();
    connectRoom({
      url: 'ws://localhost/api/rooms/room-1/ws/play',
      hello: playerHello({ name: 'たろう', token: TOKEN }),
      onMessage: store.getState().receive,
      onStatus: store.getState().connectionChanged,
      createSocket: server.createSocket,
    });
    server.latest.open();
    server.latest.emit({ type: 'joined', participantId: ME, room: snapshot('lobby', null) });
    server.latest.emit(questionShown(0));

    server.latest.closeFromServer(1006);
    expect(store.getState().connection).toBe('reconnecting');
    vi.runOnlyPendingTimers();
    server.latest.open();
    expect(server.latest.received).toEqual([{ type: 'resume', token: TOKEN }]);
    server.latest.emit({
      type: 'resumed',
      participantId: ME,
      name: 'たろう',
      score: 500,
      room: snapshot('accepting', 1),
    });
    server.latest.emit(questionShown(1));
    server.latest.emit(answeringStarted(1, 4_000));

    expect(store.getState()).toMatchObject({
      connection: 'open',
      me: { participantId: ME, name: 'たろう', score: 500 },
      room: snapshot('accepting', 1),
      question: { questionId: 'q-1', choices: ['A', 'B'], remainingMs: 4_000 },
    });
  });
});
