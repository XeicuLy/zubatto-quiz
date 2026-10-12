import * as z from 'zod';

import { choiceIndexSchema, questionIndexSchema } from '../question-set.ts';

/**
 * 端末からサーバーへ送るメッセージ。部屋の DO は信用できない入力として、必ず decodeClientMessage で検査してから使う。
 *
 * - どのメッセージも participantId を持たない。回答者は接続の attachment で見分ける（S4・ADR 0004）。
 *   z.object は知らない項目を取り除くので、本文に書いて送っても部屋の DO には届かない
 * - 進行操作は、attachment の role が host の接続からだけ受け付ける（ADR 0003）。見分けるには isHostCommand を使う
 */

/** 名前の長さの上限。JSON Schema の maxLength と同じく、コードポイントで数える */
export const NAME_MAX_LENGTH = 32;

/** 1つのメッセージの長さの上限（UTF-16 の文字数）。JSON として読む前に確かめる */
export const MAX_CLIENT_MESSAGE_LENGTH = 1_024;

/**
 * 回答者の名前。前後の空白を除いてから確かめる。
 * かぶりの確認に使う NFKC の正規化は、表示名を変えないよう部屋の DO で別に行う（ADR 0004）
 */
export const playerNameSchema = z
  .string()
  .trim()
  .min(1)
  // 改行やタブなどの制御文字（Cc）は、ランキングの1行の表示を崩すので拒む。
  // ゼロ幅スペースや文字の向きを変える文字などの書式の文字（Cf）は、同じ見た目の別の名前を作れるので拒む。
  // 名前のかぶりの確認（NFKC）をすり抜けて、他人のふりができてしまうため。
  // ただし、ZWJ（U+200D）は家族の絵文字などをつなぐのに要るので通す。
  // ZWJ だけを足した「たろう」も同じ見た目になるので、部屋の DO のかぶりの確認では ZWJ も除いて比べる（T19）
  .regex(/^(?:[^\p{Cc}\p{Cf}]|\u200D)*$/u, '制御文字や見えない書式の文字は使えない')
  // ZWJ は見えないので、ZWJ と空白だけの名前は空の名前と同じ扱いにする。
  // '\u200D \u200D' は外側が ZWJ なので、最初の trim では間の空白が残る。ZWJ を除いてからもう一度 trim する
  .refine((name) => name.replaceAll('\u200D', '').trim().length > 0, '名前が空')
  // .max() は UTF-16 の長さで数えるので、絵文字が2文字分になる。JSON Schema の maxLength（コードポイント）にそろえる
  .refine((name) => [...name].length <= NAME_MAX_LENGTH, `名前は${NAME_MAX_LENGTH}文字まで`)
  .meta({
    maxLength: NAME_MAX_LENGTH,
    description:
      '前後の空白を除いてから、長さ（コードポイント）と制御文字を確かめる。ZWJ（U+200D）と空白だけの名前は拒む',
  });

/**
 * 再接続用の秘密。端末が作る32バイトの乱数を、base64url（= なし）にした43文字（ADR 0004）。
 * 43文字は258ビットを表すので、32バイトちょうどなら最後の文字の下2ビットは0になる。
 * ログに出すときは redactToken で伏せる
 */
export const playerTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/, '32バイトの base64url ではない');

/** 部屋の DO が付ける問題の ID。中身の形には頼らない */
export const questionIdSchema = z.string().min(1).max(64);

export const joinSchema = z.object({
  type: z.literal('join'),
  name: playerNameSchema,
  token: playerTokenSchema,
});
export type Join = z.infer<typeof joinSchema>;

export const resumeSchema = z.object({
  type: z.literal('resume'),
  token: playerTokenSchema,
});
export type Resume = z.infer<typeof resumeSchema>;

export const answerSchema = z.object({
  type: z.literal('answer'),
  questionId: questionIdSchema,
  choiceIndex: choiceIndexSchema,
  /** 選択肢が表示されてから押すまでの、端末で計ったミリ秒（P2）。制限時間に収めて0.01秒単位に切り捨てるのはサーバー */
  elapsedMs: z.int().min(0),
});
export type Answer = z.infer<typeof answerSchema>;

/** 回答者が送るメッセージ。未確認の接続（attachment が null）からは join と resume だけを受け付ける */
export const playerMessageSchema = z.discriminatedUnion('type', [joinSchema, resumeSchema, answerSchema]);
export type PlayerMessage = z.infer<typeof playerMessageSchema>;

/**
 * 問題を対象にする進行操作。questionIndex が今の状態と合わないときは、部屋の DO が状態を変えずに invalid_state を返す。
 * ボタンの2度押しや、つなぎ直した直後の古い画面からの操作で、問題を飛ばさないため
 */
function questionCommandSchema<const T extends string>(type: T) {
  return z.object({ type: z.literal(type), questionIndex: questionIndexSchema });
}

/** 出題。「次の問題へ」も、次の問題の番号を付けたこの操作で行う */
export const showQuestionSchema = questionCommandSchema('showQuestion');
/** 受付開始。選択肢を配り、制限時間を数え始める */
export const startAnsweringSchema = questionCommandSchema('startAnswering');
/** 締切。時間切れを待たずに締め切る */
export const closeAnsweringSchema = questionCommandSchema('closeAnswering');
/** ② 最速正解を発表する */
export const revealFastestSchema = questionCommandSchema('revealFastest');
/** ③ 途中経過を出す。最後の2問では受け付けない */
export const showStandingsSchema = questionCommandSchema('showStandings');
/** 問題のやり直し（A3）。締切の前の問題だけ。その問題の回答を捨てて、出題の段階に戻し、questionShown を配り直す */
export const retryQuestionSchema = questionCommandSchema('retryQuestion');
/** 最後の問題のあとに、最終ランキングを出す */
export const showFinalRankingSchema = z.object({ type: z.literal('showFinalRanking') });
/** 部屋を終える。すべての接続を room_ended で閉じる */
export const endRoomSchema = z.object({ type: z.literal('endRoom') });

export const hostCommandSchema = z.discriminatedUnion('type', [
  showQuestionSchema,
  startAnsweringSchema,
  closeAnsweringSchema,
  revealFastestSchema,
  showStandingsSchema,
  retryQuestionSchema,
  showFinalRankingSchema,
  endRoomSchema,
]);
export type HostCommand = z.infer<typeof hostCommandSchema>;

export const clientMessageSchema = z.discriminatedUnion('type', [
  ...playerMessageSchema.options,
  ...hostCommandSchema.options,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

const hostCommandTypes: ReadonlySet<string> = new Set(
  hostCommandSchema.options.map((option) => option.shape.type.value),
);

export function isHostCommand(message: ClientMessage): message is HostCommand {
  return hostCommandTypes.has(message.type);
}

export type DecodeResult = { success: true; data: ClientMessage } | { success: false };

/**
 * WebSocket で受け取った値を検査する。失敗の理由は返さない。
 * 端末へは error { code: 'invalid_message' } だけを返し、ログに中身を出すときは redactToken を通す
 */
export function decodeClientMessage(raw: string | ArrayBuffer): DecodeResult {
  if (typeof raw !== 'string' || raw.length > MAX_CLIENT_MESSAGE_LENGTH) {
    return { success: false };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { success: false };
  }
  const result = clientMessageSchema.safeParse(json);
  return result.success ? { success: true, data: result.data } : { success: false };
}
