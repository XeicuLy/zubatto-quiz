import { zValidator } from '@hono/zod-validator';
import type { HttpError } from '@zubatto-quiz/protocol';
import type * as z from 'zod';

/** JSON の本文を schema で確かめる。合わなければ、項目ごとの理由は付けずに 400 を返す */
export const jsonBody = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'invalid_request' } satisfies HttpError, 400);
    }
  });

/** 他人のものとないものに返す本文。403 にすると、それがあることが漏れるので、どちらも 404 にする（S1） */
export const notFound = { error: 'not_found' } satisfies HttpError;
