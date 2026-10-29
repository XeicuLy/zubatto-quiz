import { expect, type BrowserContext } from '@playwright/test';
import {
  createQuestionSetResponseSchema,
  createRoomResponseSchema,
  type CreateRoomResponse,
  type QuestionSetInput,
} from '@zubatto-quiz/protocol';

/**
 * 問題セットを作り、その部屋を開く（F1）。context はホストとしてログインしておく。
 * 部屋の作り方は full-game.spec.ts が画面で確かめているので、ほかの spec では API で作る
 */
export async function createRoom(context: BrowserContext, questionSet: QuestionSetInput): Promise<CreateRoomResponse> {
  const set = await context.request.post('/api/question-sets', { data: questionSet });
  expect(set.status()).toBe(201);
  const { id } = createQuestionSetResponseSchema.parse(await set.json());
  const created = await context.request.post('/api/rooms', { data: { questionSetId: id } });
  expect(created.status()).toBe(201);
  return createRoomResponseSchema.parse(await created.json());
}
