import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildWsJsonSchema } from './json-schema.ts';

describe('schema/ws.schema.json', () => {
  it('zod のスキーマから書き出したものと同じ（ADR 0001）', () => {
    const committed: unknown = JSON.parse(readFileSync(new URL('../schema/ws.schema.json', import.meta.url), 'utf8'));
    expect(
      committed,
      'メッセージ仕様と ws.schema.json がずれている。pnpm --filter @zubatto-quiz/protocol run schema で書き出し直す',
    ).toEqual(buildWsJsonSchema());
  });
});

describe('buildWsJsonSchema', () => {
  const schema = buildWsJsonSchema();

  it('端末からのメッセージ・サーバーからのメッセージ・閉じる理由のコードを持つ', () => {
    expect(Object.keys(schema.$defs)).toEqual(['ClientMessage', 'ServerMessage', 'CloseCode']);
  });

  it('端末からのメッセージは、受け付ける入力の形で書く（知らない項目は取り除いて受け付ける）', () => {
    expect(JSON.stringify(schema.$defs.ClientMessage)).not.toContain('"additionalProperties":false');
  });

  it('名前の長さの上限が maxLength に出る', () => {
    expect(JSON.stringify(schema.$defs.ClientMessage)).toContain('"maxLength":32');
  });
});
