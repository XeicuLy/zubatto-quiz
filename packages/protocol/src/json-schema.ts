import * as z from 'zod';

import { clientMessageSchema } from './ws/client-messages.ts';
import { closeCodeSchema } from './ws/close-codes.ts';
import { serverMessageSchema } from './ws/server-messages.ts';

/**
 * WebSocket のメッセージ仕様を JSON Schema にする。schema/ws.schema.json に置き、Go へ置き換えるときの正本にする（ADR 0001）。
 * .refine() で書いた条件（名前をコードポイントで数えることなど）は JSON Schema に出ないので、zod のコードも合わせて読む
 */
export function buildWsJsonSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ズバクイの WebSocket のメッセージ',
    $defs: {
      // サーバーが受け付ける入力の形。知らない項目は取り除いて受け付けるので、additionalProperties: false を付けない
      ClientMessage: toDef(clientMessageSchema, 'input'),
      // サーバーが送る形。仕様にない項目は送る前に落とす
      ServerMessage: toDef(serverMessageSchema, 'output'),
      CloseCode: toDef(closeCodeSchema, 'output'),
    },
  };
}

function toDef(schema: z.ZodType, io: 'input' | 'output') {
  // 1つのファイルにまとめるので、それぞれに付く $schema は外す
  const { $schema: _, ...def } = z.toJSONSchema(schema, { io });
  return def;
}
