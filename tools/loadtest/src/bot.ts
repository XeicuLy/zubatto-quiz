import { randomBytes } from 'node:crypto';

import type { AnsweringStarted } from '@zubatto-quiz/protocol';

import { isType, RoomSocket, type Received } from './connection.ts';
import type { AnswerOutcome } from './metrics.ts';

/**
 * 回答の時間の決め方
 *
 * - spread: 受付のあいだ（残りの 0〜90%）に、ばらばらに答える。ふだんの本番に近い
 * - burst: 残りの 85〜90% のあいだに、全員がまとめて答える。締切の直前の一斉回答（P3）を再現する
 */
export type AnswerMode = 'spread' | 'burst';

/** answeringStarted を受け取ってから答えるまでの待ち時間 */
export function answerDelayMs(mode: AnswerMode, remainingMs: number, random: () => number = Math.random): number {
  const ratio = mode === 'burst' ? 0.85 + random() * 0.05 : random() * 0.9;
  return remainingMs * ratio;
}

/** 回答者と同じ形の秘密（32バイトの base64url、43文字）。ボットのメモリにだけ持ち、ログにも画面にも出さない（ADR 0004） */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 入室を待つ上限。部屋の DO は未確認の接続を10秒で閉じる */
const JOIN_TIMEOUT_MS = 10_000;

/** 回答を送ったあと、返事を待っている印 */
const PENDING = 'pending';

/**
 * 回答者のふりをするボット1体。
 * join して、受付開始が届いたら answerDelayMs だけ待って、ランダムな選択肢で答える
 */
export class Bot {
  readonly name: string;
  readonly socket: RoomSocket;
  readonly #mode: AnswerMode;
  /** 問題ごとの回答の結果。送って返事を待っているあいだは PENDING */
  readonly #outcomes = new Map<string, AnswerOutcome | typeof PENDING>();
  readonly #timers = new Map<string, NodeJS.Timeout>();
  /** 返事を待っている回答の問題。部屋の DO の error は questionId を持たないので、直前に送った回答への返事とみなす */
  #pendingQuestionId: string | null = null;

  private constructor(name: string, socket: RoomSocket, mode: AnswerMode) {
    this.name = name;
    this.socket = socket;
    this.#mode = mode;
    socket.subscribe((received) => this.#onMessage(received));
  }

  /** 回答者の入口につないで join する。入れなければ、閉じたときの code を付けて失敗する */
  static async join(url: string, origin: string, name: string, mode: AnswerMode): Promise<Bot> {
    const socket = new RoomSocket({ url, origin });
    await socket.opened.catch((error: unknown) => {
      throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    });
    const bot = new Bot(name, socket, mode);
    socket.send({ type: 'join', name, token: newToken() });
    const joined = await socket.waitFor(isType('joined'), JOIN_TIMEOUT_MS);
    if (joined === null) {
      socket.close();
      throw new Error(`${name} が入室できなかった（close code ${socket.closeCode ?? 'なし'}）`);
    }
    return bot;
  }

  #onMessage({ message, at }: Received) {
    switch (message.type) {
      case 'answeringStarted':
        this.#scheduleAnswer(message, at);
        break;
      case 'answerAccepted':
        this.#settle(message.questionId, { kind: 'accepted' });
        break;
      case 'error':
        if (this.#pendingQuestionId !== null) {
          this.#settle(this.#pendingQuestionId, { kind: 'rejected', code: message.code });
        }
        break;
    }
  }

  #scheduleAnswer({ questionId, choices, remainingMs }: AnsweringStarted, startedAt: number) {
    if (this.#outcomes.has(questionId) || this.#timers.has(questionId)) {
      return;
    }
    const timer = setTimeout(
      () => {
        this.#timers.delete(questionId);
        const choiceIndex = Math.floor(Math.random() * choices.length);
        // 画面と同じく、選択肢を受け取ってから押すまでの時間を、整数のミリ秒で送る
        const elapsedMs = Math.floor(performance.now() - startedAt);
        const sentAt = this.socket.send({ type: 'answer', questionId, choiceIndex, elapsedMs });
        if (sentAt === null) {
          this.#outcomes.set(questionId, { kind: 'unsent' });
          return;
        }
        this.#outcomes.set(questionId, PENDING);
        this.#pendingQuestionId = questionId;
      },
      answerDelayMs(this.#mode, remainingMs),
    );
    this.#timers.set(questionId, timer);
  }

  #settle(questionId: string, outcome: AnswerOutcome) {
    if (this.#outcomes.get(questionId) === PENDING) {
      this.#outcomes.set(questionId, outcome);
    }
    if (this.#pendingQuestionId === questionId) {
      this.#pendingQuestionId = null;
    }
  }

  /**
   * その問題の結果（myResult）を受け取ったあとに呼び、回答の結果を確定する。
   * 答える前に締め切られたら undefined（答えなかった）を返す
   */
  finishQuestion(questionId: string): AnswerOutcome | undefined {
    clearTimeout(this.#timers.get(questionId));
    this.#timers.delete(questionId);
    const outcome = this.#outcomes.get(questionId);
    return outcome === PENDING ? { kind: 'no_reply' } : outcome;
  }

  close() {
    for (const timer of this.#timers.values()) {
      clearTimeout(timer);
    }
    this.socket.close();
  }
}
