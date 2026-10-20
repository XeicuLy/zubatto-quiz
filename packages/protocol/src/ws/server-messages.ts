import * as z from 'zod';

import {
  choiceIndexSchema,
  choiceTextSchema,
  limitMsSchema,
  MAX_CHOICES,
  MIN_CHOICES,
  questionIndexSchema,
} from '../question-set.ts';
import { questionIdSchema } from './client-messages.ts';

/**
 * サーバーから端末へ送るメッセージ。部屋の DO は、必ず encodeServerMessage を通して送る。
 * z.object は知らない項目を取り除くので、うっかり正解や順位を入れても端末には届かない（S2・F15）。
 *
 * 1問の流れ（docs/design/README.md）に合わせて、メッセージを分ける。
 * 出題 → 受付開始 → ① 正解と回答の分布（締切） → ② 最速正解の発表 → ③ 途中経過（ホストが出したいときだけ） → 次の問題
 */

/** 部屋の DO が crypto.randomUUID() で発行する（ADR 0004）。参加者一覧やランキングで全員に配られる */
export const participantIdSchema = z.uuid();

/** 表示名。join で検査済みのものだけが入る */
const displayNameSchema = z.string();
const countSchema = z.int().min(0);
const pointsSchema = z.int().min(0);
/** 0.01秒単位に切り捨てた経過時間（P2） */
const elapsedMsSchema = z.int().min(0);
/** 順位が上がった幅。下がったときは送らず0にする（順位の見せ方） */
const rankUpSchema = z.int().min(0);

/**
 * 部屋の今の段階。部屋の状態の要約（roomSnapshotSchema）に入れる。
 * - lobby: 待機（参加者一覧）
 * - question: 出題（読み上げ中）
 * - accepting: 受付中
 * - revealed: ① 正解と回答の分布
 * - fastest: ② 最速正解の発表
 * - standings: ③ 途中経過
 * - final: 最終ランキング
 */
export const roomPhaseSchema = z.enum(['lobby', 'question', 'accepting', 'revealed', 'fastest', 'standings', 'final']);
export type RoomPhase = z.infer<typeof roomPhaseSchema>;

/**
 * 部屋の今の状態の要約。joined・resumed・hostReady に入れる。
 * 部屋の DO は、これに続けて今の段階のメッセージ（出題・受付開始・① ② ③ など）を送り直す。
 * 端末は、ふだんの進行と同じ処理で今の画面に戻れる
 */
export const roomSnapshotSchema = z.object({
  title: z.string(),
  questionCount: z.int().min(1),
  phase: roomPhaseSchema,
  /** lobby のときは null */
  questionIndex: questionIndexSchema.nullable(),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

/** 1部屋の回答者の上限（SC1）。部屋の DO は51人目を room_full で断り、ホストの待機画面は「/ 50 人」と出す */
export const MAX_PARTICIPANTS = 50;

export const participantSummarySchema = z.object({
  participantId: participantIdSchema,
  name: displayNameSchema,
});

// ---- 入室 ----

/** join が通った。秘密は端末が持っているので返さない */
export const joinedSchema = z.object({
  type: z.literal('joined'),
  participantId: participantIdSchema,
  room: roomSnapshotSchema,
});
export type Joined = z.infer<typeof joinedSchema>;

/** resume が通った。名前と得点は部屋の DO の正本から返す */
export const resumedSchema = z.object({
  type: z.literal('resumed'),
  participantId: participantIdSchema,
  name: displayNameSchema,
  score: pointsSchema,
  room: roomSnapshotSchema,
});
export type Resumed = z.infer<typeof resumedSchema>;

/** ホスト用の接続を、部屋の持ち主として受け付けた（ADR 0003） */
export const hostReadySchema = z.object({
  type: z.literal('hostReady'),
  room: roomSnapshotSchema,
});
export type HostReady = z.infer<typeof hostReadySchema>;

/** 参加者一覧。入室のたびに全員へ送る（F3） */
export const participantsSchema = z.object({
  type: z.literal('participants'),
  participants: z.array(participantSummarySchema),
});
export type Participants = z.infer<typeof participantsSchema>;

// ---- 出題から締切まで ----

/**
 * 出題。読み上げのあいだは問題文だけを出すので、選択肢はまだ送らない。
 * 開発者ツールで選択肢を先に見て、考える時間を稼げないようにする（P2）。正解は持たない（S2）
 */
export const questionShownSchema = z.object({
  type: z.literal('questionShown'),
  questionId: questionIdSchema,
  questionIndex: questionIndexSchema,
  questionCount: z.int().min(1),
  /** Markdown（F5）。生の HTML を許さずに描画する */
  text: z.string(),
  limitMs: limitMsSchema,
});
export type QuestionShown = z.infer<typeof questionShownSchema>;

/** 受付開始。ここで初めて選択肢を送る。正解は持たない（S2） */
export const answeringStartedSchema = z.object({
  type: z.literal('answeringStarted'),
  questionId: questionIdSchema,
  choices: z.array(choiceTextSchema).min(MIN_CHOICES).max(MAX_CHOICES),
  limitMs: limitMsSchema,
  /** 締切までの残り。ふだんは limitMs と同じで、つなぎ直して送り直したときだけ短い */
  remainingMs: z.int().min(0),
});
export type AnsweringStarted = z.infer<typeof answeringStartedSchema>;

/** 回答を受け付けた。回答した本人にだけ送る。elapsedMs はサーバーが制限時間に収めて切り捨てた値 */
export const answerAcceptedSchema = z.object({
  type: z.literal('answerAccepted'),
  questionId: questionIdSchema,
  choiceIndex: choiceIndexSchema,
  elapsedMs: elapsedMsSchema,
});
export type AnswerAccepted = z.infer<typeof answerAcceptedSchema>;

/**
 * 回答した人数（「回答 12 / 18 人」）。受付中に、回答を受け付けるたびにホストへだけ送る。
 * 回答者の画面には出さないので、締切の直前に50人が一斉に答えても、送るのは回答1件につきホストの接続の数だけで済む
 */
export const answerProgressSchema = z.object({
  type: z.literal('answerProgress'),
  questionId: questionIdSchema,
  answeredCount: countSchema,
  participantCount: countSchema,
});
export type AnswerProgress = z.infer<typeof answerProgressSchema>;

// ---- ① 正解と回答の分布 ----

/** ① ホストへ: 正解と、選択肢ごとの人数（F13） */
export const revealedSchema = z.object({
  type: z.literal('revealed'),
  questionId: questionIdSchema,
  correctIndex: choiceIndexSchema,
  /** choices と同じ並びで、それぞれを選んだ人数 */
  choiceCounts: z.array(countSchema).min(MIN_CHOICES).max(MAX_CHOICES),
  answeredCount: countSchema,
  participantCount: countSchema,
});
export type Revealed = z.infer<typeof revealedSchema>;

/**
 * 回答者ごとの自分の位置（F15）。順位の数字を持つのは1〜3位だけ。
 * 「1つ上の人」は、自分より点の高い人のうち一番点の低い人。差の計算は packages/scoring（T14・T23）
 */
export const playerPositionSchema = z.discriminatedUnion('kind', [
  /** 1位。2位との差を出す。ほかに回答者がいなければ null */
  z.object({ kind: z.literal('leader'), rankUp: rankUpSchema, leadOverNext: pointsSchema.nullable() }),
  /** 2位・3位。順位と、1つ上の人との差 */
  z.object({ kind: z.literal('podium'), rank: z.literal([2, 3]), rankUp: rankUpSchema, gapToAbove: pointsSchema }),
  /** 4位以下。順位の数字は持たない。「8位まで」と書くと自分の順位が分かるので、差だけを出す */
  z.object({ kind: z.literal('chasing'), rankUp: rankUpSchema, gapToAbove: pointsSchema, gapToTop: pointsSchema }),
  /** 最後の2問。順位にかかわることは何も持たない */
  z.object({ kind: z.literal('hidden') }),
]);
export type PlayerPosition = z.infer<typeof playerPositionSchema>;

/** ① 回答者1人ずつへ: 正解・自分の正誤と得点・自分の位置 */
export const myResultSchema = z.object({
  type: z.literal('myResult'),
  questionId: questionIdSchema,
  correctIndex: choiceIndexSchema,
  /** 時間切れ（未回答）なら null */
  answer: z.object({ choiceIndex: choiceIndexSchema, elapsedMs: elapsedMsSchema }).nullable(),
  correct: z.boolean(),
  /** この問題の得点 */
  points: pointsSchema,
  /** points のうちの早押しボーナス（F12）。もらえなかったら0。画面は設定値を持たず、この点をそのまま出す */
  bonusPoints: pointsSchema,
  totalScore: pointsSchema,
  /** 残りの問題で取れる最大の点（残りの問題数 × 1問の最大の点）。順位にかかわらないので最後の2問でも送る */
  remainingMaxPoints: pointsSchema,
  position: playerPositionSchema,
});
export type MyResult = z.infer<typeof myResultSchema>;

// ---- ② 最速正解の発表 ----

export const fastAnswerSchema = z.object({
  participantId: participantIdSchema,
  name: displayNameSchema,
  elapsedMs: elapsedMsSchema,
});

/** この問題で一番順位を上げた人。上げた幅だけを持ち、順位の数字は持たない */
export const climberSchema = z.object({
  participantId: participantIdSchema,
  name: displayNameSchema,
  rankUp: z.int().min(1),
});

const fastestBaseShape = {
  type: z.literal('fastest'),
  questionId: questionIdSchema,
  correctIndex: choiceIndexSchema,
  /** 速い順に3人まで。正解者がいなければ空 */
  fastest: z.array(fastAnswerSchema).max(3),
  correctCount: countSchema,
  answeredCount: countSchema,
};

/** ② 全員へ: 最速の3人と秒数・正解した人数・その問題で一番順位を上げた人（F14） */
export const fastestRevealedSchema = z.discriminatedUnion('ranksHidden', [
  z.object({
    ...fastestBaseShape,
    ranksHidden: z.literal(false),
    /** 第1問（順位の変化がない）と、誰も順位を上げなかったときは null */
    biggestClimber: climberSchema.nullable(),
  }),
  /** 最後の2問。一番順位を上げた人を持たない */
  z.object({ ...fastestBaseShape, ranksHidden: z.literal(true) }),
]);
export type FastestRevealed = z.infer<typeof fastestRevealedSchema>;

// ---- ③ 途中経過と最終ランキング ----

/** 同点は同じ順位（1位・2位・2位・4位）で、同じ順位の人は入室した順に並べる */
const rankedEntrySchema = z.object({
  participantId: participantIdSchema,
  name: displayNameSchema,
  rank: z.int().min(1),
  totalScore: pointsSchema,
});

/** ③ 全員へ: 上位10人の途中経過。最後の2問では送らない */
export const standingsSchema = z.object({
  type: z.literal('standings'),
  questionId: questionIdSchema,
  questionIndex: questionIndexSchema,
  participantCount: countSchema,
  entries: z.array(rankedEntrySchema.extend({ points: pointsSchema })).max(10),
});
export type Standings = z.infer<typeof standingsSchema>;

/** 全員へ: 最終ランキング（全員の順位） */
export const finalRankingSchema = z.object({
  type: z.literal('finalRanking'),
  questionCount: z.int().min(1),
  entries: z.array(rankedEntrySchema),
});
export type FinalRanking = z.infer<typeof finalRankingSchema>;

// ---- エラー ----

/**
 * - invalid_message: JSON として読めない、または仕様に合わない
 * - not_verified: 未確認の接続から、join・resume 以外を送った
 * - not_host: ホスト用でない接続から、進行操作を送った
 * - invalid_state: 今の状態ではできない進行操作（questionIndex が合わないなど）
 * - not_accepting: 受付中でない問題への回答
 * - already_answered: 同じ問題への2回目の回答（S4）
 * - invalid_choice: その問題の選択肢の数を超える choiceIndex
 */
export const errorCodeSchema = z.enum([
  'invalid_message',
  'not_verified',
  'not_host',
  'invalid_state',
  'not_accepting',
  'already_answered',
  'invalid_choice',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** 接続は閉じずに、送った本人へ返すエラー。閉じるときは CLOSE_CODES を使う */
export const errorMessageSchema = z.object({
  type: z.literal('error'),
  code: errorCodeSchema,
});
export type ErrorMessage = z.infer<typeof errorMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion('type', [
  joinedSchema,
  resumedSchema,
  hostReadySchema,
  participantsSchema,
  questionShownSchema,
  answeringStartedSchema,
  answerAcceptedSchema,
  answerProgressSchema,
  revealedSchema,
  myResultSchema,
  fastestRevealedSchema,
  standingsSchema,
  finalRankingSchema,
  errorMessageSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/**
 * 送る前に検査して、仕様にない項目を落としてから JSON にする。
 * 仕様に合わないメッセージは送らずに例外にする（部屋の DO の誤りなので、握りつぶさない）
 */
export function encodeServerMessage(message: z.input<typeof serverMessageSchema>): string {
  return JSON.stringify(serverMessageSchema.parse(message));
}
