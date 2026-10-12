import type { HostCommand, RoomPhase } from '@zubatto-quiz/protocol';

/**
 * 部屋の進行の状態（docs/design/README.md の「1問の流れ」）。SQLite の room の行から読む。
 * 終えた部屋（ended）は、段階をそのまま残し、どの進行操作も受け付けない
 */
export type RoomState = { phase: RoomPhase; questionIndex: number | null; ended: boolean };

export type TransitionResult = { ok: true; next: RoomState } | { ok: false };

const rejected: TransitionResult = { ok: false };
const moveTo = (phase: RoomPhase, questionIndex: number | null): TransitionResult => ({
  ok: true,
  next: { phase, questionIndex, ended: false },
});

/** ② のあと（③ を出したかどうかによらない）。次の問題と最終ランキングは、ここからだけ進める */
const isAfterFastest = (phase: RoomPhase) => phase === 'fastest' || phase === 'standings';

/**
 * 今の問題を対象にする操作と、それを受け付ける段階・移る先の段階。
 * 締切のあとは ① → ② →（③）の順にしか進めない（F14・F15）。やり直しは、締切の前の問題だけ（A3）
 */
const currentQuestionMoves = {
  startAnswering: { from: ['question'], to: 'accepting' },
  closeAnswering: { from: ['accepting'], to: 'revealed' },
  revealFastest: { from: ['revealed'], to: 'fastest' },
  showStandings: { from: ['fastest'], to: 'standings' },
  retryQuestion: { from: ['question', 'accepting'], to: 'question' },
} as const satisfies Record<string, { from: readonly RoomPhase[]; to: RoomPhase }>;

/** ③ 途中経過を出せるか（F15）。最後の2問では、順位を伏せて最終ランキングまで引っ張る。問題が2問以下なら、どの問題でも出せない */
export const canShowStandings = (questionIndex: number, questionCount: number): boolean =>
  questionIndex < questionCount - 2;

/**
 * 進行操作を今の状態に当てたときの、次の状態を返す。受け付けない操作なら { ok: false }。
 * DB も時刻も見ない純粋な関数にして、遷移の表をそのままテストできるようにする。
 * 何を SQLite に書き、何を配るかは handlers/host-commands.ts で決める
 */
export function transition(state: RoomState, command: HostCommand, questionCount: number): TransitionResult {
  if (state.ended) {
    return rejected;
  }
  switch (command.type) {
    case 'endRoom':
      // どの段階からでも終えられる。すぐに止めたいときの手段になる（ADR 0003）
      return { ok: true, next: { ...state, ended: true } };
    case 'showFinalRanking': {
      const isLast = state.questionIndex === questionCount - 1;
      return isLast && isAfterFastest(state.phase) ? moveTo('final', state.questionIndex) : rejected;
    }
    case 'showQuestion': {
      // 番号を付けて送るので、2度押しや古い画面からの操作で、問題を飛ばさない
      const { questionIndex } = command;
      const isNext =
        state.phase === 'lobby'
          ? questionIndex === 0
          : isAfterFastest(state.phase) && questionIndex === (state.questionIndex ?? -1) + 1;
      return isNext && questionIndex < questionCount ? moveTo('question', questionIndex) : rejected;
    }
    default: {
      const { questionIndex } = command;
      const move = currentQuestionMoves[command.type];
      const fromOk = (move.from as readonly RoomPhase[]).includes(state.phase);
      if (questionIndex !== state.questionIndex || !fromOk) {
        return rejected;
      }
      if (command.type === 'showStandings' && !canShowStandings(questionIndex, questionCount)) {
        return rejected;
      }
      return moveTo(move.to, questionIndex);
    }
  }
}
