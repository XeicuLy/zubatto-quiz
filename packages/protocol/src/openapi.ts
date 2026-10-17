import { httpErrorSchema } from './http/errors.ts';
import {
  createQuestionSetResponseSchema,
  listQuestionSetsResponseSchema,
  questionSetDetailSchema,
} from './http/question-sets.ts';
import { createRoomRequestSchema, createRoomResponseSchema } from './http/rooms.ts';
import { toDef } from './json-schema.ts';
import { questionSetSchema } from './question-set.ts';

type Ref = { $ref: string };
type Operation = {
  operationId: string;
  summary: string;
  requestBody?: { required: true; content: { 'application/json': { schema: Ref } } };
  responses: Record<string, Ref | { description: string; content?: { 'application/json': { schema: Ref } } }>;
};
type PathItem = { parameters?: Ref[] } & Partial<Record<'get' | 'post' | 'put' | 'delete', Operation>>;

/**
 * HTTP API の仕様を OpenAPI 3.1 にする。schema/openapi.json に置き、Go へ置き換えるときの正本にする（ADR 0001）。
 * Go 側は oapi-codegen などで型を作れる。経路の定義は apps/api/src/routes にあり、状態コードはそれに合わせて書く。
 *
 * OpenAPI 3.1 のスキーマは JSON Schema 2020-12 なので、z.toJSONSchema の出力をそのまま components.schemas に置ける。
 * 要求の本文は受け付ける入力の形（input）、応答は送る形（output）で作る。ws.schema.json と同じ考え方
 */
export function buildOpenApiDocument() {
  const schemas = {
    QuestionSetInput: toDef(questionSetSchema, 'input'),
    QuestionSetDetail: toDef(questionSetDetailSchema, 'output'),
    ListQuestionSetsResponse: toDef(listQuestionSetsResponseSchema, 'output'),
    CreateQuestionSetResponse: toDef(createQuestionSetResponseSchema, 'output'),
    CreateRoomRequest: toDef(createRoomRequestSchema, 'input'),
    CreateRoomResponse: toDef(createRoomResponseSchema, 'output'),
    HttpError: toDef(httpErrorSchema, 'output'),
  };
  const schema = (name: keyof typeof schemas) => ({ $ref: `#/components/schemas/${name}` });
  const jsonBody = (name: keyof typeof schemas) => ({ 'application/json': { schema: schema(name) } });
  const requestBody = (name: keyof typeof schemas) => ({ required: true as const, content: jsonBody(name) });

  const responses = {
    BadRequest: {
      description: '本文が仕様に合わない。JSON として読めないときは、Hono がテキストで返す',
      content: { ...jsonBody('HttpError'), 'text/plain': { schema: { type: 'string' } } },
    },
    Unauthorized: {
      description: 'ログインしていない、またはセッションが切れた',
      content: jsonBody('HttpError'),
    },
    Forbidden: {
      description:
        'csrf() が別のオリジンからのフォームの形の要求を断った。Hono がテキストで返す。本文が JSON の要求と、同じオリジンの要求では起きない',
      content: { 'text/plain': { schema: { type: 'string' } } },
    },
    NotFound: {
      description: 'ない、または他人のもの。どちらかは区別しない（S1）',
      content: jsonBody('HttpError'),
    },
  };
  const response = (name: keyof typeof responses) => ({ $ref: `#/components/responses/${name}` });

  const paths: Record<string, PathItem> = {
    '/api/question-sets': {
      get: {
        operationId: 'listQuestionSets',
        summary: '自分の問題セットの一覧を、更新の新しい順に返す',
        responses: {
          '200': { description: '一覧', content: jsonBody('ListQuestionSetsResponse') },
          '401': response('Unauthorized'),
        },
      },
      post: {
        operationId: 'createQuestionSet',
        summary: '問題セットを作る（F4）',
        requestBody: requestBody('QuestionSetInput'),
        responses: {
          '201': { description: '作った', content: jsonBody('CreateQuestionSetResponse') },
          '400': response('BadRequest'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
        },
      },
    },
    '/api/question-sets/{id}': {
      parameters: [{ $ref: '#/components/parameters/QuestionSetId' }],
      get: {
        operationId: 'getQuestionSet',
        summary: '正解を含む問題セットの全体を返す。ホストの編集画面だけが使う（S2）',
        responses: {
          '200': { description: '問題セット', content: jsonBody('QuestionSetDetail') },
          '401': response('Unauthorized'),
          '404': response('NotFound'),
        },
      },
      put: {
        operationId: 'updateQuestionSet',
        summary: '問題セットを丸ごと置き換える（F7）',
        requestBody: requestBody('QuestionSetInput'),
        responses: {
          '204': { description: '置き換えた' },
          '400': response('BadRequest'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '404': response('NotFound'),
        },
      },
      delete: {
        operationId: 'deleteQuestionSet',
        summary: '問題セットを消す',
        responses: {
          '204': { description: '消した' },
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '404': response('NotFound'),
        },
      },
    },
    '/api/rooms': {
      post: {
        operationId: 'createRoom',
        summary: '自分の問題セットから部屋を作る（F1・ADR 0002）。セットは作ったときの中身が部屋に写る',
        requestBody: requestBody('CreateRoomRequest'),
        responses: {
          '201': { description: '作った', content: jsonBody('CreateRoomResponse') },
          '400': response('BadRequest'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '404': response('NotFound'),
        },
      },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'ズバクイの HTTP API',
      version: '1.0.0',
      description: [
        'ホストだけが使う HTTP API（S1）。部屋の進行は WebSocket で、その仕様は ws.schema.json にある。',
        '',
        'JSON Schema に出ない条件は、packages/protocol の zod のコードも合わせて読む。',
        '- 文字列は前後の空白を取り除いてから長さを数え、取り除いた値を保存する',
        '- 正解の番号は選択肢の数より小さい（Question の description にも書く）',
      ].join('\n'),
    },
    // 画面の Worker が /api/* を API の Worker へ渡すので、画面と同じオリジンで呼ぶ（ADR 0006）
    servers: [{ url: '/', description: '画面と同じオリジン' }],
    security: [{ hostSession: [] }],
    paths,
    components: {
      securitySchemes: {
        hostSession: {
          type: 'apiKey',
          in: 'cookie',
          name: '__Secure-better-auth.session_token',
          description:
            'GitHub でログインしたホストのセッションの Cookie（ADR 0003）。http の手元では __Secure- が付かない',
        },
      },
      parameters: {
        QuestionSetId: {
          name: 'id',
          in: 'path',
          required: true,
          description: '問題セットの ID（UUID）。UUID の形でない値も、他人のセットの ID と同じく 404 になる',
          schema: { type: 'string' },
        },
      },
      schemas,
      responses,
    },
  };
}
