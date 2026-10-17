import { parseArgs } from 'node:util';

import { MAX_LIMIT_MS, MAX_PARTICIPANTS, MAX_QUESTIONS, MIN_LIMIT_MS } from '@zubatto-quiz/protocol';
import * as z from 'zod';

import { Bot, type AnswerMode } from './bot.ts';
import { isType, RoomSocket } from './connection.ts';
import {
  createQuestionSet,
  createRoom,
  deleteQuestionSet,
  loadtestQuestionSet,
  playRoom,
  roomSocketUrl,
  type HostSession,
} from './host.ts';
import { buildReport, formatMarkdownTable, plannedMetrics, type RunMetrics } from './metrics.ts';

/**
 * O2 のリハーサル（ADR 0001）。複数の部屋に複数のボットを入れて最後まで遊び、P1・P3・P4 を表にする。
 * 使い方は README.md。表は標準出力に、途中の様子は標準エラーに出すので、`> result.md` で表だけを残せる
 */

const COOKIE_ENV = 'ZUBAKUI_HOST_COOKIE';

const optionsSchema = z.object({
  /** 画面の Worker のオリジン。パスが付いていても、オリジンだけを使う */
  origin: z.url({ protocol: /^https?$/ }).transform((url) => new URL(url).origin),
  rooms: z.coerce.number().int().min(1).default(5),
  bots: z.coerce.number().int().min(1).max(MAX_PARTICIPANTS).default(50),
  questions: z.coerce.number().int().min(1).max(MAX_QUESTIONS).default(3),
  /** 制限時間（秒）。F9 の範囲 */
  limit: z.coerce
    .number()
    .int()
    .min(MIN_LIMIT_MS / 1_000)
    .max(MAX_LIMIT_MS / 1_000)
    .default(10),
  burst: z.boolean().default(false),
});
type Options = z.infer<typeof optionsSchema>;

function readOptions(): Options {
  const { values } = parseArgs({
    options: {
      origin: { type: 'string' },
      rooms: { type: 'string' },
      bots: { type: 'string' },
      questions: { type: 'string' },
      limit: { type: 'string' },
      burst: { type: 'boolean' },
    },
  });
  const parsed = optionsSchema.safeParse(values);
  if (!parsed.success) {
    throw new Error(`引数が正しくない\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Cookie は引数で受け取らない。引数はシェルの履歴とプロセスの一覧に残るため */
function readCookie(): string {
  const cookie = process.env[COOKIE_ENV]?.trim();
  if (!cookie) {
    throw new Error(`環境変数 ${COOKIE_ENV} に、ホストのセッションの Cookie（名前=値）を入れる。README.md を参照`);
  }
  return cookie;
}

const log = (line: string) => console.error(line);

/** 1部屋ぶん。ホストとボットをつなぎ、最後まで進めて、接続を閉じる */
async function runRoom(
  session: HostSession,
  roomId: string,
  index: number,
  options: Options,
  metrics: RunMetrics,
): Promise<void> {
  const label = `部屋${index + 1}`;
  const host = new RoomSocket({
    url: roomSocketUrl(session.origin, roomId, 'host'),
    origin: session.origin,
    cookie: session.cookie,
  });
  const bots: Bot[] = [];
  try {
    await host.opened;
    if ((await host.waitFor(isType('hostReady'), 10_000)) === null) {
      throw new Error(`${label}: hostReady が届かなかった（close code ${host.closeCode ?? 'なし'}）`);
    }

    const mode: AnswerMode = options.burst ? 'burst' : 'spread';
    const playUrl = roomSocketUrl(session.origin, roomId, 'play');
    const joins = await Promise.allSettled(
      Array.from({ length: options.bots }, (_, n) =>
        Bot.join(playUrl, session.origin, `ボット${index + 1}-${String(n + 1).padStart(2, '0')}`, mode),
      ),
    );
    for (const join of joins) {
      if (join.status === 'fulfilled') {
        bots.push(join.value);
      } else {
        metrics.notes.push(`${label}: ${join.reason instanceof Error ? join.reason.message : String(join.reason)}`);
      }
    }
    log(`${label}: ${bots.length} / ${options.bots} 体が入室`);

    await playRoom(
      host,
      bots,
      { label, questionCount: options.questions, limitMs: options.limit * 1_000 },
      metrics,
      log,
    );
  } finally {
    for (const bot of bots) {
      bot.close();
    }
    host.close();
  }
}

async function main() {
  const options = readOptions();
  const session: HostSession = { origin: options.origin, cookie: readCookie() };
  log(
    `${options.origin} に ${options.rooms} 部屋 × ${options.bots} 体、${options.questions} 問（制限 ${options.limit} 秒、${options.burst ? '締切の直前に一斉に回答' : 'ばらばらに回答'}）`,
  );

  // 部屋を作ったら問題セットは要らないので、すぐに消す。部屋の DO は問題を写し終えている（ADR 0002）
  const questionSetId = await createQuestionSet(session, loadtestQuestionSet(options.questions, options.limit * 1_000));
  const roomIds: string[] = [];
  try {
    for (let index = 0; index < options.rooms; index += 1) {
      roomIds.push((await createRoom(session, questionSetId)).roomId);
    }
  } finally {
    await deleteQuestionSet(session, questionSetId);
  }

  const metrics = plannedMetrics(options);
  const results = await Promise.allSettled(
    roomIds.map((roomId, index) => runRoom(session, roomId, index, options, metrics)),
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      metrics.notes.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  const rows = buildReport(metrics);
  console.log(formatMarkdownTable(rows));
  if (metrics.notes.length > 0) {
    console.log(['', ...metrics.notes.map((note) => `- ${note}`)].join('\n'));
  }
  process.exitCode = rows.every((row) => row.passed) ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
