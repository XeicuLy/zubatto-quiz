import type { RoomPhase, RoomSnapshot, ServerMessage } from '@zubatto-quiz/protocol';

/** 鳴らす音。sound-player.ts が、それぞれを合成して鳴らす */
export type SoundCue =
  /** 出題 */
  | 'question'
  /** 締切 */
  | 'closed'
  /** ホストの正解発表 */
  | 'reveal'
  /** 回答者の正解発表。自分が正解した */
  | 'correct'
  /** 回答者の正解発表。自分が間違えた */
  | 'incorrect';

export interface SoundCues {
  /** 届いたメッセージで鳴らす音を、鳴らす順に返す。鳴らさないときは空 */
  next(message: ServerMessage): readonly SoundCue[];
}

/**
 * 届いたメッセージから、鳴らす音を決める（F18）。接続ごとに1つ作り、届いた順にすべて渡す。
 *
 * つなぎ直すと、部屋の DO は joined・resumed・hostReady のすぐあとに、今の問題の流れを出題から順に、今の段階まで送り直す
 * （apps/api の room/resend.ts）。それをそのまま鳴らすと、出題・締切・正解発表の音がまとめて鳴る。
 * そこで、hostReady などで届いた部屋の段階を「追いつく先」として覚え、その段階のメッセージが届くまでは鳴らさない。
 * 送り直しは部屋の DO が一度に送るので、追いついたあとに届くものは、どれも新しく起きたことになる
 */
export function createSoundCues(): SoundCues {
  /** 送り直しで追いつく先。null なら追いついている */
  let catchingUp: RoomSnapshot | null = null;

  return {
    next(message) {
      if (message.type === 'joined' || message.type === 'resumed' || message.type === 'hostReady') {
        // 待機中は、送り直すものがない
        catchingUp = message.room.phase === 'lobby' ? null : message.room;
        return [];
      }
      if (catchingUp !== null) {
        // 送り直しが今の段階まで届かなかったときの逃げ道。別の問題の出題は、送り直しではなく新しい出題
        if (message.type !== 'questionShown' || message.questionIndex === catchingUp.questionIndex) {
          // 今の段階のメッセージが送り直しの最後。それ自体も送り直しなので鳴らさない
          if (phaseOf(message) === catchingUp.phase) {
            catchingUp = null;
          }
          return [];
        }
        catchingUp = null;
      }
      return cuesOf(message);
    },
  };
}

/** メッセージが表す段階。段階を表さないもの（参加者一覧・回答の人数など）は null */
function phaseOf(message: ServerMessage): RoomPhase | null {
  switch (message.type) {
    case 'questionShown':
      return 'question';
    case 'answeringStarted':
      return 'accepting';
    case 'revealed':
    case 'myResult':
      return 'revealed';
    case 'fastest':
      return 'fastest';
    case 'standings':
      return 'standings';
    case 'finalRanking':
      return 'final';
    default:
      return null;
  }
}

/**
 * 追いついたあとに届いたメッセージの音。締切と ① の正解発表は同じメッセージで届くので、締切の音に続けて鳴らす。
 * 答えなかった回答者には、締切の音だけを鳴らす
 */
function cuesOf(message: ServerMessage): readonly SoundCue[] {
  switch (message.type) {
    case 'questionShown':
      return ['question'];
    case 'revealed':
      return ['closed', 'reveal'];
    case 'myResult':
      if (message.answer === null) {
        return ['closed'];
      }
      return ['closed', message.correct ? 'correct' : 'incorrect'];
    default:
      return [];
  }
}
