import { describe, expect, expectTypeOf, it } from 'vitest';
import { ZodError } from 'zod';

import {
  type ClientMessage,
  clientMessageSchema,
  decodeClientMessage,
  isHostCommand,
  NAME_MAX_LENGTH,
} from './client-messages.ts';
import { CLOSE_CODES } from './close-codes.ts';
import {
  type AnsweringStarted,
  type FastestRevealed,
  type MyResult,
  type PlayerPosition,
  type QuestionShown,
  encodeServerMessage,
  type ServerMessage,
  serverMessageSchema,
} from './server-messages.ts';

/** 端末と同じく、32バイトの乱数を base64url（= なし）にする */
function makeToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

describe('clientMessageSchema: 入室（ADR 0004）', () => {
  it('join { name, token } を受け付ける', () => {
    const token = makeToken();
    expect(clientMessageSchema.parse({ type: 'join', name: 'たろう', token })).toEqual({
      type: 'join',
      name: 'たろう',
      token,
    });
  });

  it('resume { token } を受け付ける', () => {
    const token = makeToken();
    expect(clientMessageSchema.parse({ type: 'resume', token })).toEqual({ type: 'resume', token });
  });

  it('名前の前後の空白を除く', () => {
    expect(clientMessageSchema.parse({ type: 'join', name: '  たろう　', token: makeToken() })).toMatchObject({
      name: 'たろう',
    });
  });
});

describe('clientMessageSchema: 不正な入力を拒む（S4・ADR 0004）', () => {
  it('長すぎる名前を拒む', () => {
    const token = makeToken();
    expect(clientMessageSchema.safeParse({ type: 'join', name: 'あ'.repeat(NAME_MAX_LENGTH), token }).success).toBe(
      true,
    );
    expect(clientMessageSchema.safeParse({ type: 'join', name: 'あ'.repeat(NAME_MAX_LENGTH + 1), token }).success).toBe(
      false,
    );
  });

  it('名前の長さはコードポイントで数える（JSON Schema の maxLength と同じ数え方）', () => {
    // 🍣 は UTF-16 では2つ分だが、1文字として数える
    expect(
      clientMessageSchema.safeParse({ type: 'join', name: '🍣'.repeat(NAME_MAX_LENGTH), token: makeToken() }).success,
    ).toBe(true);
  });

  it('空の名前と、制御文字を含む名前を拒む', () => {
    const token = makeToken();
    expect(clientMessageSchema.safeParse({ type: 'join', name: '　 ', token }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'join', name: 'たろう\nはなこ', token }).success).toBe(false);
  });

  it('見えない書式の文字を含む名前を拒む（名前のかぶりの確認をすり抜けて、他人のふりをさせない）', () => {
    const token = makeToken();
    // ゼロ幅スペース: 「たろう」と同じに見えるが、NFKC で正規化しても別の名前になる
    expect(clientMessageSchema.safeParse({ type: 'join', name: 'たろう\u200B', token }).success).toBe(false);
    // 文字の向きを右から左に変える: 表示を逆にして、別の名前に見せかけられる
    expect(clientMessageSchema.safeParse({ type: 'join', name: '\u202Eうろた', token }).success).toBe(false);
    // BOM（ゼロ幅のノーブレークスペース）。前後にあると trim で除かれるので、途中に置く
    expect(clientMessageSchema.safeParse({ type: 'join', name: 'たろ\uFEFFう', token }).success).toBe(false);
  });

  it('ZWJ（U+200D）と空白だけの名前を拒む（画面には空の名前に見える）', () => {
    const token = makeToken();
    expect(clientMessageSchema.safeParse({ type: 'join', name: '\u200D', token }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'join', name: '\u200D\u200D', token }).success).toBe(false);
    // 外側が ZWJ なので、trim では間の空白が除かれない
    expect(clientMessageSchema.safeParse({ type: 'join', name: '\u200D \u200D', token }).success).toBe(false);
  });

  it('絵文字をつなぐ ZWJ（U+200D）は通す', () => {
    const token = makeToken();
    expect(clientMessageSchema.safeParse({ type: 'join', name: '👨‍👩‍👧‍👦ファミリー', token }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: 'join', name: '🍣🍺🍣🍺🍣🍺', token }).success).toBe(true);
  });

  it('32バイトでない token を拒む', () => {
    expect(clientMessageSchema.safeParse({ type: 'resume', token: makeToken(31) }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'resume', token: makeToken(33) }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'resume', token: '' }).success).toBe(false);
  });

  it('base64url でない token と、パディング付きの token を拒む', () => {
    const token = makeToken();
    expect(clientMessageSchema.safeParse({ type: 'resume', token: `${token.slice(0, -1)}+` }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'resume', token: `${token}=` }).success).toBe(false);
  });

  it('32バイトを表さない43文字（最後の文字の余りのビットが0でない）を拒む', () => {
    // 43文字は258ビットなので、最後の文字の下2ビットは0でなければならない。B は 000001
    expect(clientMessageSchema.safeParse({ type: 'resume', token: `${'A'.repeat(42)}B` }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: 'resume', token: `${'A'.repeat(42)}E` }).success).toBe(true);
  });

  it('範囲外の choiceIndex を拒む', () => {
    const answer = { type: 'answer', questionId: 'q1', elapsedMs: 2_370 };
    expect(clientMessageSchema.safeParse({ ...answer, choiceIndex: 3 }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ ...answer, choiceIndex: 4 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ ...answer, choiceIndex: -1 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ ...answer, choiceIndex: 1.5 }).success).toBe(false);
  });

  it('負の経過時間と、整数でない経過時間を拒む', () => {
    const answer = { type: 'answer', questionId: 'q1', choiceIndex: 0 };
    expect(clientMessageSchema.safeParse({ ...answer, elapsedMs: -1 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ ...answer, elapsedMs: 0.5 }).success).toBe(false);
  });

  it('知らない type を拒む', () => {
    expect(clientMessageSchema.safeParse({ type: 'cheat' }).success).toBe(false);
  });
});

describe('clientMessageSchema: participantId を本文に持たせない（S4・ADR 0004）', () => {
  it('どのメッセージの型にも participantId がない', () => {
    expectTypeOf<Extract<ClientMessage, { participantId: unknown }>>().toBeNever();
  });

  it('本文に participantId を書いて送っても、検査のあとには残らない', () => {
    const parsed = clientMessageSchema.parse({
      type: 'answer',
      participantId: '00000000-0000-4000-8000-000000000000',
      questionId: 'q1',
      choiceIndex: 0,
      elapsedMs: 1_000,
    });
    expect(parsed).not.toHaveProperty('participantId');
  });
});

describe('clientMessageSchema: ホストの進行操作', () => {
  it('どの進行操作も、対象の問題の番号を持てる', () => {
    for (const type of [
      'showQuestion',
      'startAnswering',
      'closeAnswering',
      'revealFastest',
      'showStandings',
      'retryQuestion',
    ] as const) {
      expect(clientMessageSchema.parse({ type, questionIndex: 2 })).toEqual({ type, questionIndex: 2 });
    }
    expect(clientMessageSchema.parse({ type: 'showFinalRanking' })).toEqual({ type: 'showFinalRanking' });
    expect(clientMessageSchema.parse({ type: 'endRoom' })).toEqual({ type: 'endRoom' });
  });

  it('問題の番号のない出題を拒む', () => {
    expect(clientMessageSchema.safeParse({ type: 'showQuestion' }).success).toBe(false);
  });

  it('進行操作と回答者のメッセージを見分けられる', () => {
    expect(isHostCommand(clientMessageSchema.parse({ type: 'startAnswering', questionIndex: 0 }))).toBe(true);
    expect(isHostCommand(clientMessageSchema.parse({ type: 'endRoom' }))).toBe(true);
    expect(isHostCommand(clientMessageSchema.parse({ type: 'resume', token: makeToken() }))).toBe(false);
  });
});

describe('decodeClientMessage', () => {
  it('JSON の文字列を検査して返す', () => {
    const token = makeToken();
    expect(decodeClientMessage(JSON.stringify({ type: 'resume', token }))).toEqual({
      success: true,
      data: { type: 'resume', token },
    });
  });

  it('JSON として読めない文字列や、文字列でない値は失敗にする', () => {
    expect(decodeClientMessage('{"type":')).toEqual({ success: false });
    expect(decodeClientMessage(new ArrayBuffer(8))).toEqual({ success: false });
  });

  it('長すぎる文字列は、JSON として読む前に失敗にする', () => {
    expect(decodeClientMessage(JSON.stringify({ type: 'endRoom', padding: 'x'.repeat(2_000) }))).toEqual({
      success: false,
    });
  });
});

const participantId = '7c0b6f5e-2a59-4a8e-9d3c-1f2e3d4c5b6a';
const room = { title: '内輪クイズ', questionCount: 10, phase: 'revealed', questionIndex: 2 } as const;

/** 送る前に通すのと同じ道を通し、端末が受け取る JSON にする */
function sent(message: Parameters<typeof encodeServerMessage>[0]): Record<string, unknown> {
  return JSON.parse(encodeServerMessage(message));
}

describe('serverMessageSchema: 入室の応答（ADR 0004）', () => {
  it('joined { participantId, room } と resumed { participantId, name, score, room } を送れる', () => {
    expect(sent({ type: 'joined', participantId, room })).toEqual({ type: 'joined', participantId, room });
    expect(sent({ type: 'resumed', participantId, name: 'たろう', score: 2_410, room })).toEqual({
      type: 'resumed',
      participantId,
      name: 'たろう',
      score: 2_410,
      room,
    });
  });

  it('joined は秘密を返さない（端末が持っている）', () => {
    expect(sent({ type: 'joined', participantId, room, token: 'x' } as never)).not.toHaveProperty('token');
  });
});

describe('serverMessageSchema: 出題に正解を含めない（S2・ADR 0002）', () => {
  it('出題と受付開始のメッセージの型に、正解のフィールドがない', () => {
    expectTypeOf<QuestionShown>().not.toHaveProperty('correctIndex');
    expectTypeOf<AnsweringStarted>().not.toHaveProperty('correctIndex');
  });

  it('正解を書き込んでしまっても、送る JSON からは落ちる', () => {
    const questionShown = {
      type: 'questionShown',
      questionId: 'q3',
      questionIndex: 2,
      questionCount: 10,
      text: '去年の忘年会で、部長が二次会で最初に歌った曲のジャンルは？',
      limitMs: 10_000,
      correctIndex: 1,
    } as const;
    expect(sent(questionShown)).not.toHaveProperty('correctIndex');

    const answeringStarted = {
      type: 'answeringStarted' as const,
      questionId: 'q3',
      choices: ['演歌', 'アニソン', '洋楽ロック', '歌っていない'],
      limitMs: 10_000,
      remainingMs: 10_000,
      correctIndex: 1,
    };
    expect(sent(answeringStarted)).not.toHaveProperty('correctIndex');
  });

  it('出題のときは、まだ選択肢を送らない（受付開始で送る）', () => {
    expectTypeOf<QuestionShown>().not.toHaveProperty('choices');
  });
});

const baseResult = {
  type: 'myResult',
  questionId: 'q3',
  correctIndex: 1,
  answer: { choiceIndex: 1, elapsedMs: 4_120 },
  correct: true,
  points: 705,
  bonusPoints: 0,
  totalScore: 1_876,
  remainingMaxPoints: 8_400,
} as const;

describe('serverMessageSchema: 早押しボーナス（F12）', () => {
  it('① 自分の結果に、この問題の得点のうちのボーナスの点を持たせる', () => {
    const position = { kind: 'leader', rankUp: 0, leadOverNext: 135 } as const;
    expect(sent({ ...baseResult, points: 1_175, bonusPoints: 200, position })).toMatchObject({
      points: 1_175,
      bonusPoints: 200,
    });
  });

  it('ボーナスの点は、もらえなかったときも0として必ず送る', () => {
    const position = { kind: 'hidden' } as const;
    const { bonusPoints: _, ...withoutBonus } = baseResult;
    expect(serverMessageSchema.safeParse({ ...withoutBonus, position }).success).toBe(false);
    expect(serverMessageSchema.safeParse({ ...baseResult, bonusPoints: -200, position }).success).toBe(false);
  });
});

describe('serverMessageSchema: 自分の位置（F15）', () => {
  it('1〜3位には順位を持たせる', () => {
    expect(sent({ ...baseResult, position: { kind: 'leader', rankUp: 0, leadOverNext: 135 } })).toMatchObject({
      position: { kind: 'leader', leadOverNext: 135 },
    });
    expect(sent({ ...baseResult, position: { kind: 'podium', rank: 3, rankUp: 2, gapToAbove: 435 } })).toMatchObject({
      position: { kind: 'podium', rank: 3, gapToAbove: 435 },
    });
  });

  it('4位以下の位置の型に、順位の数字がない', () => {
    expectTypeOf<Extract<PlayerPosition, { kind: 'chasing' }>>().not.toHaveProperty('rank');
  });

  it('4位以下へ送る位置には、順位の数字を入れても含まれない', () => {
    const message = sent({
      ...baseResult,
      position: { kind: 'chasing', rankUp: 5, gapToAbove: 224, gapToTop: 1_104, rank: 7 } as never,
    });
    expect(message.position).toEqual({ kind: 'chasing', rankUp: 5, gapToAbove: 224, gapToTop: 1_104 });
  });

  it('podium は2位と3位だけ（1位は leader、4位以下は chasing）', () => {
    for (const rank of [1, 4]) {
      expect(
        serverMessageSchema.safeParse({ ...baseResult, position: { kind: 'podium', rank, rankUp: 0, gapToAbove: 10 } })
          .success,
      ).toBe(false);
    }
  });

  it('順位が下がった幅は送らない（rankUp は0以上）', () => {
    expect(
      serverMessageSchema.safeParse({
        ...baseResult,
        position: { kind: 'chasing', rankUp: -2, gapToAbove: 38, gapToTop: 1_413 },
      }).success,
    ).toBe(false);
  });
});

describe('serverMessageSchema: 最後の2問は順位を伏せる（F15）', () => {
  it('伏せた位置の型は、順位にかかわる項目を持たない', () => {
    expectTypeOf<Extract<PlayerPosition, { kind: 'hidden' }>>().toEqualTypeOf<{ kind: 'hidden' }>();
  });

  it('① 自分の結果で、伏せた位置に順位や差を入れても含まれない', () => {
    const message = sent({
      ...baseResult,
      remainingMaxPoints: 1_200,
      position: { kind: 'hidden', rank: 3, rankUp: 2, gapToAbove: 435, gapToTop: 600 } as never,
    });
    expect(message.position).toEqual({ kind: 'hidden' });
  });

  const fastest = [
    { participantId, name: 'はなこ', elapsedMs: 2_480 },
    { participantId: '0b8e5f3a-6c1d-4e2f-8a9b-7c6d5e4f3a2b', name: '部長', elapsedMs: 3_100 },
  ];

  it('② 最速正解の発表で、伏せたときの型は一番順位を上げた人を持たない', () => {
    expectTypeOf<Extract<FastestRevealed, { ranksHidden: true }>>().not.toHaveProperty('biggestClimber');
  });

  it('② 最速正解の発表で、伏せたときは一番順位を上げた人を入れても含まれない', () => {
    const message = sent({
      type: 'fastest',
      questionId: 'q9',
      ranksHidden: true,
      correctIndex: 2,
      fastest,
      correctCount: 5,
      answeredCount: 18,
      biggestClimber: { participantId, name: 'はなこ', rankUp: 4 },
    } as never);
    expect(message).not.toHaveProperty('biggestClimber');
    expect(message).toMatchObject({ ranksHidden: true, correctCount: 5 });
  });

  it('② 伏せていないときは、一番順位を上げた人（上げた幅だけ）を持てる', () => {
    const message = sent({
      type: 'fastest',
      questionId: 'q3',
      ranksHidden: false,
      correctIndex: 1,
      fastest,
      correctCount: 8,
      answeredCount: 16,
      biggestClimber: { participantId, name: '経理のたなか', rankUp: 5, rank: 7 } as never,
    });
    expect(message.biggestClimber).toEqual({ participantId, name: '経理のたなか', rankUp: 5 });
  });

  it('最速正解者は3人まで', () => {
    const four = [...fastest, ...fastest];
    expect(
      serverMessageSchema.safeParse({
        type: 'fastest',
        questionId: 'q9',
        ranksHidden: true,
        correctIndex: 2,
        fastest: four,
        correctCount: 5,
        answeredCount: 18,
      }).success,
    ).toBe(false);
  });
});

describe('serverMessageSchema: 途中経過と最終ランキング', () => {
  const entry = { participantId, name: 'たろう', rank: 1, points: 1_000, totalScore: 2_980 };

  it('③ 途中経過は上位10人まで', () => {
    const standings = { type: 'standings', questionId: 'q3', questionIndex: 2, participantCount: 18 } as const;
    expect(
      serverMessageSchema.safeParse({ ...standings, entries: Array.from({ length: 10 }, () => entry) }).success,
    ).toBe(true);
    expect(
      serverMessageSchema.safeParse({ ...standings, entries: Array.from({ length: 11 }, () => entry) }).success,
    ).toBe(false);
  });

  it('最終ランキングは全員の順位を持つ', () => {
    const { points: _, ...finalEntry } = entry;
    const entries = Array.from({ length: 50 }, () => finalEntry);
    expect(serverMessageSchema.safeParse({ type: 'finalRanking', questionCount: 10, entries }).success).toBe(true);
  });
});

describe('serverMessageSchema', () => {
  it('知らない type は送れない', () => {
    expect(() => encodeServerMessage({ type: 'secret' } as never)).toThrow(ZodError);
  });

  it('結果の型（MyResult）は ServerMessage に含まれる', () => {
    expectTypeOf<MyResult>().toExtend<ServerMessage>();
  });
});

describe('CLOSE_CODES', () => {
  it('アプリが使える 4000〜4999 に収まり、重ならない', () => {
    const codes = Object.values(CLOSE_CODES);
    for (const code of codes) {
      expect(code).toBeGreaterThanOrEqual(4_000);
      expect(code).toBeLessThanOrEqual(4_999);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('未確認の時間切れは 4408（T5・ADR 0004）', () => {
    expect(CLOSE_CODES.join_timeout).toBe(4_408);
  });

  it('Issue で決めた閉じる理由をすべて持つ', () => {
    expect(Object.keys(CLOSE_CODES).sort()).toEqual(
      [
        'connection_limit',
        'join_timeout',
        'name_taken',
        'replaced',
        'resume_failed',
        'room_ended',
        'room_full',
        'room_not_found',
      ].sort(),
    );
  });

  it('ない部屋・他人の部屋は 4404（S1・ADR 0004）', () => {
    expect(CLOSE_CODES.room_not_found).toBe(4_404);
  });
});
