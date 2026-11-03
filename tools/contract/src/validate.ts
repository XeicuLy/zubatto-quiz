import { readFileSync } from 'node:fs';

import addFormats from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';

/** OpenAPI の応答オブジェクト。`$ref` のときは components/responses を指す */
interface ResponseObject {
  $ref?: string;
  content?: Record<string, unknown>;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, { responses?: Record<string, ResponseObject> }>>;
  components: { responses: Record<string, ResponseObject> };
}

const readSchema = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../../../packages/protocol/schema/${name}`, import.meta.url), 'utf8'));

/** ws.schema.json の ServerMessage の枝。type の値を読むところだけを書く */
interface MessageBranch {
  properties?: { type?: { const?: unknown } };
  oneOf?: MessageBranch[];
}

const wsSchema = readSchema<{ $defs: { ServerMessage: { oneOf: MessageBranch[] } } }>('ws.schema.json');
const openApi = readSchema<OpenApiDocument>('openapi.json');

// zod とは別の検証器で、書き出した JSON Schema だけを読んで確かめる。zod のずれは zod では見つからない
const ajv = new Ajv2020();
// uuid・date-time・uri の format を確かめる。joinUrl の uri は pattern がないので、format でしか捕まらない
addFormats(ajv);
// openapi.json を丸ごと読み込み、中の $ref を ajv に解かせる。JSON Schema にない最上位のキーは、strict モードで止まらないように知らせておく
ajv.addVocabulary(['openapi', 'info', 'servers', 'security', 'paths', 'components']);
ajv.addSchema(wsSchema, 'ws.schema.json');
ajv.addSchema(openApi, 'openapi.json');

/** JSON pointer の1段分。`/` と `~` を逃がす（RFC 6901） */
const escapePointer = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1');

/** 読み込んだスキーマの中の位置（`ws.schema.json#/…`）にあるスキーマで調べ、合わなければ投げる */
function check(key: string, label: string, data: unknown): void {
  const validate = ajv.getSchema(key);
  if (!validate) throw new Error(`${key} にスキーマがない`);
  if (!validate(data)) throw new Error(ajv.errorsText(validate.errors, { dataVar: label }));
}

/** openapi.json に書いた、経路と状態コードの応答と、その JSON pointer を引く */
function describedResponse(operation: string, status: string): { described: ResponseObject; pointer: string } {
  const [method = '', path = ''] = operation.split(' ');
  const listed = openApi.paths[path]?.[method.toLowerCase()]?.responses;
  if (!listed) throw new Error(`openapi.json に ${operation} がない`);
  const described = listed[status];
  if (!described) throw new Error(`openapi.json に ${operation} が ${status} を返すと書いていない`);
  if (!described.$ref) {
    return { described, pointer: `/paths/${escapePointer(path)}/${method.toLowerCase()}/responses/${status}` };
  }

  // 401 などは components/responses の応答を指すので、1段たどる。この $ref は OpenAPI のもので、ajv は解かない
  const name = described.$ref.replace('#/components/responses/', '');
  const shared = openApi.components.responses[name];
  if (!shared) throw new Error(`openapi.json に ${described.$ref} がない`);
  return { described: shared, pointer: `/components/responses/${escapePointer(name)}` };
}

/** 本文を JSON として読む。読めなければ、どの応答かを書いて投げる */
function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} の本文が JSON として読めない: ${text.slice(0, 100)}`, { cause: error });
  }
}

/** 枝が受け付ける type の値。fastest のように oneOf が入れ子になった枝は、中の枝の値を集める */
const typesOf = (branch: MessageBranch): unknown[] =>
  branch.oneOf ? branch.oneOf.flatMap(typesOf) : [branch.properties?.type?.const];

/** ServerMessage の oneOf の枝ごとの、受け付ける type の値。枝の番号が JSON pointer になる */
const serverMessageTypes = wsSchema.$defs.ServerMessage.oneOf.map(typesOf);

/**
 * サーバーが送ったメッセージ（JSON.parse したもの）を、ws.schema.json の ServerMessage で調べる。合わなければ投げる。
 * oneOf 全体で調べると、14通りすべての合わないところが並んで原因が埋もれるので、type が同じ枝だけで調べる
 */
export function validateServerMessage(message: unknown): void {
  const type = typeof message === 'object' && message !== null && 'type' in message ? message.type : undefined;
  const index = serverMessageTypes.findIndex((types) => types.includes(type));
  if (index === -1) throw new Error(`type が ${JSON.stringify(type)} の形は ws.schema.json にない`);
  check(`ws.schema.json#/$defs/ServerMessage/oneOf/${index}`, `ws.schema.json の ${String(type)}`, message);
}

/**
 * HTTP の応答を、openapi.json の経路と状態コードの応答で調べ、読んだ本文を返す（本文がない応答は undefined）。
 * operation は openapi.json のキーをそのまま書く（`'GET /api/question-sets/{id}'`）。合わなければ投げる
 */
export async function validateResponse(operation: string, response: Response): Promise<unknown> {
  const label = `${operation} ${response.status}`;
  const { described, pointer } = describedResponse(operation, String(response.status));

  // 204 は本文を持てない（fetch も捨てる）ので、本文は調べない
  if (!described.content) return undefined;

  // `text/plain; charset=UTF-8` の charset は除いて比べる
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!Object.hasOwn(described.content, contentType)) {
    throw new Error(`${label} の content-type が ${contentType || '（なし）'} で、openapi.json に書いた型と違う`);
  }

  const body = contentType === 'application/json' ? parseJson(await response.text(), label) : await response.text();
  check(`openapi.json#${pointer}/content/${escapePointer(contentType)}/schema`, label, body);
  return body;
}
