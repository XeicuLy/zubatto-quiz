import { canSend, type HostCommand, type RoomSnapshot, transition } from '@zubatto-quiz/protocol';

/**
 * 進行画面のボタンに出す、進む操作（やり直しと終了は除く）。
 * 押せるかは、部屋の DO と同じ規則（protocol の canSend）で決めるので、押したのに断られる食い違いが起きない。
 * 並びはボタンを並べる順。最後のものを、いちばん押してほしい操作として目立たせる
 */
export function forwardCommandsOf(room: RoomSnapshot): HostCommand[] {
  // 待機では今の問題がないので、第1問を出すことだけが候補になる
  if (room.questionIndex === null) {
    return canSend(room, { type: 'showQuestion', questionIndex: 0 })
      ? [{ type: 'showQuestion', questionIndex: 0 }]
      : [];
  }
  const candidates: HostCommand[] = [
    { type: 'startAnswering', questionIndex: room.questionIndex },
    { type: 'closeAnswering', questionIndex: room.questionIndex },
    { type: 'revealFastest', questionIndex: room.questionIndex },
    { type: 'showStandings', questionIndex: room.questionIndex },
    { type: 'showQuestion', questionIndex: room.questionIndex + 1 },
    { type: 'showFinalRanking' },
  ];
  return candidates.filter((command) => canSend(room, command));
}

/** 進行画面を描き分ける単位。段階か問題が変わると、進行画面は描き直され、押したボタンも消える */
export type Stage = Pick<RoomSnapshot, 'phase' | 'questionIndex'>;

/**
 * 送った操作が通ったら移る段階。段階も問題も変わらない操作と、今は送れない操作は null。
 * 出題中のやり直し（出題に戻るだけ）と部屋を終えるのは変わらない。部屋の DO と同じ transition で決める
 */
export function stageAfter(room: RoomSnapshot, command: HostCommand): Stage | null {
  const result = transition(
    { phase: room.phase, questionIndex: room.questionIndex, ended: false },
    command,
    room.questionCount,
  );
  if (!result.ok || (result.next.phase === room.phase && result.next.questionIndex === room.questionIndex)) {
    return null;
  }
  return { phase: result.next.phase, questionIndex: result.next.questionIndex };
}
