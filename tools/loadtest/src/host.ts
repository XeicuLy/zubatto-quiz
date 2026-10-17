import {
  canShowStandings,
  createQuestionSetResponseSchema,
  createRoomResponseSchema,
  httpErrorSchema,
  questionSetSchema,
  type CreateRoomResponse,
  type QuestionSetInput,
  type QuestionShown,
  type ServerMessage,
} from '@zubatto-quiz/protocol';

import type { Bot } from './bot.ts';
import { isType, type Match, type RoomSocket } from './connection.ts';
import type { LatencyKind, RunMetrics } from './metrics.ts';

/** ホストのセッション。cookie はログに出さない */
export interface HostSession {
  /** 画面の Worker のオリジン（例: https://zubakui.example.workers.dev） */
  origin: string;
  /** Cookie ヘッダーにそのまま入れる値（例: __Secure-better-auth.session_token=…） */
  cookie: string;
}

/**
 * ホストのセッションで HTTP API を呼ぶ。
 * Cookie で認証する状態を変える経路は csrf() を通るので、ブラウザと同じ Origin と Sec-Fetch-Site を付ける
 */
async function callApi(session: HostSession, method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(new URL(path, session.origin), {
    method,
    headers: {
      Origin: session.origin,
      'Sec-Fetch-Site': 'same-origin',
      Cookie: session.cookie,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    // 本文は { error: code } だけなので出してよい。Cookie や要求の中身は出さない
    const error = httpErrorSchema.safeParse(await response.json().catch(() => null));
    const code = error.success ? `（${error.data.error}）` : '';
    const hint = response.status === 401 ? '。ZUBAKUI_HOST_COOKIE のセッションが切れていないか確かめる' : '';
    throw new Error(`${method} ${path} が ${response.status}${code} を返した${hint}`);
  }
  return response;
}

/** リハーサル用の問題セット。正解は0番に固定する（ボットはランダムに答えるので、得点はばらける） */
export function loadtestQuestionSet(questionCount: number, limitMs: number): QuestionSetInput {
  return questionSetSchema.parse({
    title: `リハーサル ${new Date().toISOString()}`,
    questions: Array.from({ length: questionCount }, (_, index) => ({
      text: `リハーサルの第${index + 1}問`,
      choices: ['A', 'B', 'C', 'D'],
      correctIndex: 0,
      limitMs,
    })),
  });
}

export async function createQuestionSet(session: HostSession, input: QuestionSetInput): Promise<string> {
  const response = await callApi(session, 'POST', '/api/question-sets', input);
  return createQuestionSetResponseSchema.parse(await response.json()).id;
}

/** 部屋の DO は問題セットを写し終えているので、部屋を作ったあとならセットを消しても遊べる（ADR 0002） */
export async function deleteQuestionSet(session: HostSession, id: string): Promise<void> {
  await callApi(session, 'DELETE', `/api/question-sets/${id}`);
}

export async function createRoom(session: HostSession, questionSetId: string): Promise<CreateRoomResponse> {
  const response = await callApi(session, 'POST', '/api/rooms', { questionSetId });
  return createRoomResponseSchema.parse(await response.json());
}

/** 部屋の WebSocket の URL。http は ws、https は wss にする */
export function roomSocketUrl(origin: string, roomId: string, entry: 'host' | 'play'): string {
  const url = new URL(`/api/rooms/${roomId}/ws/${entry}`, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/**
 * closeAnswering を送ったあとの、ホストへの revealed の届き方
 *
 * - measured: 送ったあとに届いた。P1 締切と P4 を測る
 * - not_revealed: 待つ上限のあいだに届かなかった。P4 の遅れか取りこぼしで、alarm のせいではない
 * - alarm_first: 送る前に届いていた。ほぼ同時に alarm が締め切ったので、時間は測れない
 */
export type CloseTiming = 'measured' | 'not_revealed' | 'alarm_first';

export function closeTimingOf(revealedAt: number | null, closedAt: number): CloseTiming {
  if (revealedAt === null) {
    return 'not_revealed';
  }
  return revealedAt >= closedAt ? 'measured' : 'alarm_first';
}

/** 1つのメッセージを待つ上限。これを過ぎたら、届かなかったものとして数える */
const WAIT_MS = 10_000;

export interface RoomPlan {
  /** ログに出す名前（部屋1 など）。部屋の ID は参加用の URL になるので出さない（S3） */
  label: string;
  questionCount: number;
  limitMs: number;
}

/**
 * 1部屋を最後まで進める。出題・受付開始・締切は送った時刻からの差を metrics に入れる（P1・P4）。
 * 締切は、全員の回答がそろったら（answerProgress）、そろわなければ制限時間が来たら送る。
 * 先に部屋の DO の alarm が締め切ったら、その問題の締切は測らず、notes に残す
 */
export async function playRoom(
  host: RoomSocket,
  bots: readonly Bot[],
  plan: RoomPlan,
  metrics: RunMetrics,
  log: (line: string) => void,
): Promise<void> {
  /** 送った時刻から、全ボットが match に合うメッセージを受け取るまでの時間を集める */
  const collect = async <T extends ServerMessage>(kind: LatencyKind | null, sentAt: number, match: Match<T>) => {
    const received = await Promise.all(bots.map((bot) => bot.socket.waitFor(match, WAIT_MS)));
    if (kind === null) {
      return;
    }
    for (const item of received) {
      if (item !== null) {
        metrics.latencies[kind].samples.push(item.at - sentAt);
      }
    }
  };
  /** ホストが送る。接続が閉じていたら、その部屋はそこで止める */
  const send = (...args: Parameters<RoomSocket['send']>): number => {
    const sentAt = host.send(...args);
    if (sentAt === null) {
      throw new Error(`${plan.label}: ホストの接続が閉じている（close code ${host.closeCode ?? 'なし'}）`);
    }
    return sentAt;
  };

  for (let questionIndex = 0; questionIndex < plan.questionCount; questionIndex += 1) {
    log(`${plan.label}: 第${questionIndex + 1}問`);

    // 出題（P1）。questionId はホストに届いた questionShown から知る
    const shownAt = send({ type: 'showQuestion', questionIndex });
    const isShown = (message: ServerMessage): message is QuestionShown =>
      message.type === 'questionShown' && message.questionIndex === questionIndex;
    const shown = await host.waitFor(isShown, WAIT_MS);
    if (shown === null) {
      throw new Error(`${plan.label}: 第${questionIndex + 1}問の questionShown がホストに届かなかった`);
    }
    const { questionId } = shown.message;
    await collect('showQuestion', shownAt, isShown);

    // 受付開始（P1）。ボットはこれを受けて、answerDelayMs のあとに答える
    const startedAt = send({ type: 'startAnswering', questionIndex });
    await collect('startAnswering', startedAt, isType('answeringStarted', questionId));

    // 全員の回答がそろうか、制限時間が来るか、alarm が先に締め切るまで待つ
    const allAnswered = (message: ServerMessage) =>
      message.type === 'answerProgress' && message.questionId === questionId && message.answeredCount >= bots.length;
    const isRevealed = isType('revealed', questionId);
    // 制限時間は、ホストが answeringStarted を受け取った時刻から数える（画面の host-room.ts と同じ）。
    // DO が数え始めるのは startAnswering が届いてからなので、送った時刻から数えると DO の締切より早く締め切ってしまう
    const hostStarted = await host.waitFor(isType('answeringStarted', questionId), WAIT_MS);
    const remainingMs = Math.max(0, (hostStarted?.at ?? startedAt) + plan.limitMs - performance.now());
    const settled = await host.waitFor(
      (message): message is ServerMessage => allAnswered(message) || isRevealed(message),
      remainingMs,
    );

    if (settled?.message.type === 'revealed') {
      metrics.notes.push(
        `${plan.label} 第${questionIndex + 1}問: 回答がそろう前に alarm が締め切ったので、締切は測っていない`,
      );
      await collect(null, 0, isType('myResult', questionId));
    } else {
      // 締切（P1）と、ホストが結果を出せるようになるまで（P4）
      const closedAt = send({ type: 'closeAnswering', questionIndex });
      const revealed = await host.waitFor(isRevealed, WAIT_MS);
      const timing = closeTimingOf(revealed?.at ?? null, closedAt);
      if (revealed !== null && timing === 'measured') {
        metrics.latencies.results.samples.push(revealed.at - closedAt);
        await collect('closeAnswering', closedAt, isType('myResult', questionId));
      } else {
        const reason =
          timing === 'not_revealed'
            ? `締切を送ったが、${WAIT_MS / 1_000}秒のあいだに revealed が届かなかった`
            : '締切を送る前に結果が届いた（alarm がほぼ同時に締め切った）ので、締切は測っていない';
        metrics.notes.push(`${plan.label} 第${questionIndex + 1}問: ${reason}`);
        await collect(null, 0, isType('myResult', questionId));
      }
    }
    for (const bot of bots) {
      const outcome = bot.finishQuestion(questionId);
      if (outcome !== undefined) {
        metrics.answers.push(outcome);
      }
    }

    // ② 最速正解と、③ 途中経過（最後の2問では出せない）。時間は測らず、全員に届くのを待ってから次へ進む
    await collect(null, send({ type: 'revealFastest', questionIndex }), isType('fastest', questionId));
    if (canShowStandings(questionIndex, plan.questionCount)) {
      await collect(null, send({ type: 'showStandings', questionIndex }), isType('standings', questionId));
    }
  }

  log(`${plan.label}: 最終ランキング`);
  await collect(null, send({ type: 'showFinalRanking' }), isType('finalRanking'));
  send({ type: 'endRoom' });
}
