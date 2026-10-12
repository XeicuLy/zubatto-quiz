import {
  questionSetSchema,
  type CreateQuestionSetResponse,
  type ListQuestionSetsResponse,
  type QuestionSetDetail,
} from '@zubatto-quiz/protocol';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';

import { requireHost, type HostEnv } from '../auth/require-host';
import { createDb } from '../db';
import {
  createQuestionSet,
  deleteQuestionSet,
  getQuestionSet,
  listQuestionSets,
  updateQuestionSet,
} from '../question-sets/repository';
import { jsonBody, notFound } from './common';

/** 本文を questionSetSchema で確かめる（F4・F9） */
const questionSetBody = jsonBody(questionSetSchema);

/**
 * 問題セットを管理する HTTP API（F4・F7）。要求と応答の形は protocol の http/question-sets.ts にある。
 *
 * D1 にはリポジトリ層だけを通して触り、ownerId は requireHost が決めた値だけを渡す（S1・ADR 0002）。
 * :id が他人のセットでも、リポジトリ層は「ない」と答えるので、ここでは持ち主を確かめない。
 *
 * csrf() は別のオリジンからのフォームの形の要求を断る（ADR 0003）。ヘッダーを見るだけで決まるので、
 * D1 のセッションを読む requireHost より前に置く。Content-Type のない要求（本文のない DELETE）も text/plain として扱い、
 * Origin か Sec-Fetch-Site が同じオリジンを示さなければ断る
 */
export const questionSetRoutes = new Hono<HostEnv>()
  .use(csrf(), requireHost)
  .get('/', async (c) => {
    const sets = await listQuestionSets(createDb(c.env.DB), { ownerId: c.get('ownerId') });
    return c.json({
      questionSets: sets.map(({ updatedAt, ...set }) => ({ ...set, updatedAt: updatedAt.toISOString() })),
    } satisfies ListQuestionSetsResponse);
  })
  .post('/', questionSetBody, async (c) => {
    const { id } = await createQuestionSet(createDb(c.env.DB), {
      ownerId: c.get('ownerId'),
      input: c.req.valid('json'),
    });
    return c.json({ id } satisfies CreateQuestionSetResponse, 201);
  })
  .get('/:id', async (c) => {
    const set = await getQuestionSet(createDb(c.env.DB), { ownerId: c.get('ownerId'), setId: c.req.param('id') });
    if (!set) {
      return c.json(notFound, 404);
    }
    // 問題の id は部屋の DO へのコピーで使うもので、編集画面の形（QuestionSetDetail）には含めない
    const { questions, ...rest } = set;
    return c.json({
      ...rest,
      questions: questions.map(({ id: _id, ...question }) => question),
    } satisfies QuestionSetDetail);
  })
  .put('/:id', questionSetBody, async (c) => {
    const updated = await updateQuestionSet(createDb(c.env.DB), {
      ownerId: c.get('ownerId'),
      setId: c.req.param('id'),
      input: c.req.valid('json'),
    });
    if (!updated) {
      return c.json(notFound, 404);
    }
    return c.body(null, 204);
  })
  .delete('/:id', async (c) => {
    const deleted = await deleteQuestionSet(createDb(c.env.DB), {
      ownerId: c.get('ownerId'),
      setId: c.req.param('id'),
    });
    if (!deleted) {
      return c.json(notFound, 404);
    }
    return c.body(null, 204);
  });
