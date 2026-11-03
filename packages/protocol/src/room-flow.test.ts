import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import json from '../fixtures/room-flow.json' with { type: 'json' };
import { questionIndexSchema } from './question-set.ts';
import { canSend, canShowStandings, transition } from './room-flow.ts';
import { hostCommandSchema } from './ws/client-messages.ts';
import { roomPhaseSchema, roomSnapshotSchema } from './ws/server-messages.ts';

// 表の行は fixtures/room-flow.json にあり、Go で書き直すときも同じ JSON を読む。
// 進行の順番は ws.schema.json に入らないので、この表が仕様になる。どの行も questionCount をはっきり持ち、
// expected は関数の戻り値をまるごと書く。
// JSON を import すると 'lobby' や 'showQuestion' が string に広がるので、protocol のスキーマで parse して型を付ける。
// 打ち間違えた段階や操作は、ここで落ちる。テスト名は行の name を使い、for とテンプレート文字列で書く（ranking.test.ts と同じ理由）

const flowStateSchema = z.strictObject({
  phase: roomPhaseSchema,
  questionIndex: questionIndexSchema.nullable(),
  ended: z.boolean(),
});
const transitionInputSchema = z.strictObject({
  state: flowStateSchema,
  command: hostCommandSchema,
  questionCount: z.int().min(1),
});

const fixture = z
  .strictObject({
    transitionAccepted: z.array(
      z.strictObject({
        name: z.string(),
        input: transitionInputSchema,
        expected: z.strictObject({ ok: z.literal(true), next: flowStateSchema }),
      }),
    ),
    transitionRejected: z.array(
      z.strictObject({
        name: z.string(),
        input: transitionInputSchema,
        expected: z.strictObject({ ok: z.literal(false) }),
      }),
    ),
    canShowStandings: z.array(
      z.strictObject({
        input: z.strictObject({ questionIndex: questionIndexSchema, questionCount: z.int().min(1) }),
        expected: z.boolean(),
      }),
    ),
    canSend: z.array(
      z.strictObject({
        name: z.string(),
        input: z.strictObject({ room: roomSnapshotSchema, command: hostCommandSchema }),
        expected: z.boolean(),
      }),
    ),
  })
  .parse(json);

describe('transition: 進行の状態の移り変わり（F8・F14・F15）', () => {
  for (const { name, input, expected } of fixture.transitionAccepted) {
    it(`${name}`, () => {
      expect(transition(input.state, input.command, input.questionCount)).toEqual(expected);
    });
  }

  for (const { name, input, expected } of fixture.transitionRejected) {
    it(`${name} は断る`, () => {
      expect(transition(input.state, input.command, input.questionCount)).toEqual(expected);
    });
  }
});

describe('canShowStandings: ③ 途中経過を出せるか（F15）', () => {
  for (const { input, expected } of fixture.canShowStandings) {
    it(`${input.questionIndex} 問目（0始まり）・全 ${input.questionCount} 問 → ${expected}`, () => {
      expect(canShowStandings(input.questionIndex, input.questionCount)).toBe(expected);
    });
  }
});

describe('canSend: 進行画面のボタンを押せるか（T32）', () => {
  for (const { name, input, expected } of fixture.canSend) {
    it(`${name} → ${expected}`, () => {
      expect(canSend(input.room, input.command)).toBe(expected);
    });
  }
});
