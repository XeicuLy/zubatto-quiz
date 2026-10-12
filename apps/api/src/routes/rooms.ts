import { createRoomRequestSchema, type CreateRoomResponse } from '@zubatto-quiz/protocol';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';

import { requireHost, type HostEnv } from '../auth/require-host';
import { createDb } from '../db';
import { getQuestionSet } from '../question-sets/repository';
import { jsonBody, notFound } from './common';

/**
 * 部屋を作る HTTP API（F1・ADR 0002）。要求と応答の形は protocol の http/rooms.ts にある。
 *
 * 問題セットの全体（正解を含む）を D1 から1回で読み、新しい部屋の DO へ initialize で写す。
 * このあと部屋は D1 を読まないので、元のセットを編集しても部屋の問題は変わらない（F7）。
 * csrf() と requireHost の順番は、問題セットの API（question-sets.ts）と同じ
 */
export const roomRoutes = new Hono<HostEnv>()
  .use(csrf(), requireHost)
  .post('/', jsonBody(createRoomRequestSchema), async (c) => {
    const ownerId = c.get('ownerId');
    // 他人のセットとないセットは、どちらも undefined になる（S1）
    const set = await getQuestionSet(createDb(c.env.DB), { ownerId, setId: c.req.valid('json').questionSetId });
    if (!set) {
      return c.json(notFound, 404);
    }

    // newUniqueId は乱数から作るので、ID から部屋を推測できない（S3）。名前から決まる idFromName は使わない
    const id = c.env.ROOM.newUniqueId();
    await c.env.ROOM.get(id).initialize({ ownerId, title: set.title, questions: set.questions });

    // 64桁の16進。WebSocket の入口では idFromString でこの部屋の DO に戻す
    const roomId = id.toString();
    // 画面の Worker のオリジンは BETTER_AUTH_URL に入っている（ADR 0006）。/r/:roomId は回答者の画面の経路
    const joinUrl = new URL(`/r/${roomId}`, c.env.BETTER_AUTH_URL).href;
    return c.json({ roomId, joinUrl } satisfies CreateRoomResponse, 201);
  });
