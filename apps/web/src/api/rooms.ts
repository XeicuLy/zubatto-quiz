import { createRoomResponseSchema, type CreateRoomRequest, type CreateRoomResponse } from '@zubatto-quiz/protocol';

import { request } from './request';

/**
 * 問題セットから部屋を作る（POST /api/rooms、F1）。要求と応答の形は protocol の http/rooms.ts にある。
 * 部屋は、この時点の問題セットを写して使うので、あとで編集しても反映されない（ADR 0002）。
 * やり直すと部屋が2つできるので、useMutation の既定のまま、失敗してもやり直さない
 */
export async function createRoom(questionSetId: string): Promise<CreateRoomResponse> {
  // request() の本文は unknown なので、ここで protocol の型を付ける。要求の形が変わったら tsc が落ちる（ADR 0011）
  const response = await request('POST', '/api/rooms', { questionSetId } satisfies CreateRoomRequest);
  return createRoomResponseSchema.parse(await response.json());
}
