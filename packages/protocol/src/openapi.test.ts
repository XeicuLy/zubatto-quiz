import { readFileSync } from 'node:fs';

import { compileErrors, validate } from '@readme/openapi-parser';
import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument } from './openapi.ts';

/** コミットした openapi.json。読むたびに新しいオブジェクトになる */
const readCommitted = () => JSON.parse(readFileSync(new URL('../schema/openapi.json', import.meta.url), 'utf8'));

describe('schema/openapi.json', () => {
  it('zod のスキーマから書き出したものと同じ（ADR 0001）', () => {
    expect(
      readCommitted(),
      'HTTP の要求と応答の形と openapi.json がずれている。pnpm --filter @zubatto-quiz/protocol run schema で書き出し直す',
    ).toEqual(buildOpenApiDocument());
  });

  it('OpenAPI 3.1 の文書として正しい（ビューアで開ける）', async () => {
    // validate は渡した文書の $ref をその場で解決して書き換えるが、readCommitted は毎回読み直すので構わない
    const result = await validate(readCommitted());
    // 正しくないときは、どこがなぜ違うかの説明が差分に出る
    expect(result.valid ? '' : compileErrors(result)).toBe('');
    expect(readCommitted().openapi).toMatch(/^3\.1\./);
  });
});

describe('buildOpenApiDocument', () => {
  const document = buildOpenApiDocument();

  /** 経路ごとの、返しうる状態コードの一覧 */
  const statusesOf = (path: string, method: 'get' | 'post' | 'put' | 'delete') =>
    Object.keys(document.paths[path]?.[method]?.responses ?? {}).sort();

  it('問題セットの5本と部屋を作る1本の経路を持つ', () => {
    const operations = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((key) => key !== 'parameters')
        .map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(operations.sort()).toEqual(
      [
        'GET /api/question-sets',
        'POST /api/question-sets',
        'GET /api/question-sets/{id}',
        'PUT /api/question-sets/{id}',
        'DELETE /api/question-sets/{id}',
        'POST /api/rooms',
      ].sort(),
    );
  });

  it('実際の経路が返す状態コードを書く（apps/api/src/routes）', () => {
    expect(statusesOf('/api/question-sets', 'get')).toEqual(['200', '401']);
    expect(statusesOf('/api/question-sets', 'post')).toEqual(['201', '400', '401', '403']);
    expect(statusesOf('/api/question-sets/{id}', 'get')).toEqual(['200', '401', '404']);
    expect(statusesOf('/api/question-sets/{id}', 'put')).toEqual(['204', '400', '401', '403', '404']);
    expect(statusesOf('/api/question-sets/{id}', 'delete')).toEqual(['204', '401', '403', '404']);
    expect(statusesOf('/api/rooms', 'post')).toEqual(['201', '400', '401', '403', '404']);
  });

  it('csrf() の 403 と壊れた JSON の 400 は、テキストで返ることも書く', () => {
    const { responses } = document.components;
    expect(Object.keys(responses.Forbidden.content)).toEqual(['text/plain']);
    expect(Object.keys(responses.BadRequest.content).sort()).toEqual(['application/json', 'text/plain']);
  });

  it('作成と更新の本文は入力の形で、limitMs を省ける（F9）', () => {
    const { QuestionSetInput, QuestionSetDetail } = document.components.schemas;
    expect(JSON.stringify(QuestionSetInput)).toContain('"required":["text","choices","correctIndex"]');
    expect(JSON.stringify(QuestionSetDetail)).toContain('"required":["text","choices","correctIndex","limitMs"]');
  });

  it('JSON Schema に出ない正解の番号の条件を description に書く', () => {
    expect(JSON.stringify(document.components.schemas.QuestionSetInput)).toContain(
      'correctIndex は choices の数より小さい',
    );
  });
});
