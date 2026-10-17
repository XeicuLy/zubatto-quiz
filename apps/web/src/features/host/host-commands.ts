import { canSend, type HostCommand, type RoomSnapshot } from '@zubatto-quiz/protocol';

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
