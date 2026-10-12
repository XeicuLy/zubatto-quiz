import {
  CLOSE_CODES,
  type CloseReason,
  type ErrorCode,
  type FastestRevealed,
  type FinalRanking,
  type MyResult,
  type Participants,
  type Revealed,
  type RoomPhase,
  type RoomSnapshot,
  type ServerMessage,
  type Standings,
} from '@zubatto-quiz/protocol';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { ConnectionStatus } from './client';

/** 今の問題について届いたもの。次の問題が出たら、まとめて置き換える */
export interface CurrentQuestion {
  questionId: string;
  questionIndex: number;
  text: string;
  limitMs: number;
  /** 受付開始で届く。出題のあいだは null（P2） */
  choices: string[] | null;
  remainingMs: number | null;
  /** 受け付けられた自分の回答 */
  answer: { choiceIndex: number; elapsedMs: number } | null;
  /** ホストだけに届く回答の人数 */
  progress: { answeredCount: number; participantCount: number } | null;
  /** ① ホストへ: 正解と回答の分布 */
  revealed: Revealed | null;
  /** ① 回答者へ: 自分の正誤と得点・位置 */
  myResult: MyResult | null;
  /** ② 最速正解 */
  fastest: FastestRevealed | null;
  /** ③ 途中経過 */
  standings: Standings | null;
}

/** 部屋の状態。正本は部屋の DO にあり、端末は届いたメッセージを写すだけ */
export interface RoomState {
  connection: ConnectionStatus;
  /** つなぎ直さずに閉じたときの理由（別のタブ・戻れない・部屋が終わったなど） */
  closeReason: CloseReason | null;
  /** joined・resumed・hostReady が届くまでは null */
  room: RoomSnapshot | null;
  /** 回答者のときだけ。名前は resumed でだけ届く */
  me: { participantId: string; name: string | null; score: number } | null;
  participants: Participants['participants'];
  question: CurrentQuestion | null;
  finalRanking: FinalRanking | null;
  lastError: ErrorCode | null;
}

export interface RoomActions {
  /** connectRoom の onMessage に渡す */
  receive(message: ServerMessage): void;
  /** connectRoom の onStatus に渡す */
  connectionChanged(status: ConnectionStatus, closeCode?: number): void;
}

export type RoomStore = StoreApi<RoomState & RoomActions>;

export const initialRoomState: RoomState = {
  connection: 'connecting',
  closeReason: null,
  room: null,
  me: null,
  participants: [],
  question: null,
  finalRanking: null,
  lastError: null,
};

/** 部屋ごとに作る。画面を離れたら捨てる */
export function createRoomStore(): RoomStore {
  return createStore<RoomState & RoomActions>()((set) => ({
    ...initialRoomState,
    receive: (message) => set((state) => applyServerMessage(state, message)),
    connectionChanged: (status, closeCode) =>
      set({ connection: status, closeReason: status === 'closed' ? closeReasonOf(closeCode) : null }),
  }));
}

/**
 * 届いたメッセージを状態に写す。変える項目だけを返す。
 * つなぎ直したときは、部屋の DO が今の段階のメッセージを送り直すので、ふだんの進行と同じ処理で今の画面に戻る
 */
export function applyServerMessage(state: RoomState, message: ServerMessage): Partial<RoomState> {
  switch (message.type) {
    case 'joined':
      return {
        ...withSnapshot(state, message.room),
        me: { participantId: message.participantId, name: null, score: 0 },
      };
    case 'resumed':
      return {
        ...withSnapshot(state, message.room),
        me: { participantId: message.participantId, name: message.name, score: message.score },
      };
    case 'hostReady':
      return withSnapshot(state, message.room);
    case 'participants':
      return { participants: message.participants };
    case 'questionShown':
      return {
        room: withPhase(state.room, 'question', message.questionIndex),
        question: {
          questionId: message.questionId,
          questionIndex: message.questionIndex,
          text: message.text,
          limitMs: message.limitMs,
          choices: null,
          remainingMs: null,
          answer: null,
          progress: null,
          revealed: null,
          myResult: null,
          fastest: null,
          standings: null,
        },
      };
    case 'answeringStarted':
      return updateQuestion(state, message.questionId, 'accepting', {
        choices: message.choices,
        remainingMs: message.remainingMs,
      });
    case 'answerAccepted':
      return updateQuestion(state, message.questionId, undefined, {
        answer: { choiceIndex: message.choiceIndex, elapsedMs: message.elapsedMs },
      });
    case 'answerProgress':
      return updateQuestion(state, message.questionId, undefined, {
        progress: { answeredCount: message.answeredCount, participantCount: message.participantCount },
      });
    case 'revealed':
      return updateQuestion(state, message.questionId, 'revealed', { revealed: message });
    case 'myResult': {
      const update = updateQuestion(state, message.questionId, 'revealed', { myResult: message });
      return state.me && update.question ? { ...update, me: { ...state.me, score: message.totalScore } } : update;
    }
    case 'fastest':
      return updateQuestion(state, message.questionId, 'fastest', { fastest: message });
    case 'standings':
      return updateQuestion(state, message.questionId, 'standings', { standings: message });
    case 'finalRanking':
      return { room: withPhase(state.room, 'final', state.room?.questionIndex ?? null), finalRanking: message };
    case 'error':
      return { lastError: message.code };
  }
}

/** 部屋の状態の要約で置き換える。要約と違う問題の表示は、古いものとして消す */
function withSnapshot(state: RoomState, room: RoomSnapshot): Partial<RoomState> {
  return {
    room,
    question: state.question?.questionIndex === room.questionIndex ? state.question : null,
    finalRanking: room.phase === 'final' ? state.finalRanking : null,
  };
}

function withPhase(room: RoomSnapshot | null, phase: RoomPhase, questionIndex: number | null): RoomSnapshot | null {
  return room && { ...room, phase, questionIndex };
}

/**
 * 今の問題へのメッセージを写す。phase を渡すと段階も進める。
 * 今の問題と違う問題へのメッセージは、やり直しや次の問題の前に出たものが遅れて届いたとみなし、無視する
 */
function updateQuestion(
  state: RoomState,
  questionId: string,
  phase: RoomPhase | undefined,
  update: Partial<CurrentQuestion>,
): Partial<RoomState> {
  if (state.question?.questionId !== questionId) {
    return {};
  }
  return {
    question: { ...state.question, ...update },
    ...(phase && { room: withPhase(state.room, phase, state.question.questionIndex) }),
  };
}

const closeReasons = new Map<number, CloseReason>(
  Object.entries(CLOSE_CODES).map(([reason, code]) => [code, reason as CloseReason]),
);

function closeReasonOf(code: number | undefined): CloseReason | null {
  return (code !== undefined && closeReasons.get(code)) || null;
}
