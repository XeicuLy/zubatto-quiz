import { questionSetSchema, type QuestionSetDetail, type QuestionSetSummary } from '@zubatto-quiz/protocol';
import { vi } from 'vitest';

/** 偽の API が受け取った要求。本文は JSON として読んだ値 */
export interface ReceivedRequest {
  method: string;
  path: string;
  body: unknown;
}

interface FakeApiOptions {
  /** ログインしているホストの名前。null ならログインしていない */
  hostName?: string | null;
  /** 一覧にだけ出す問題セット。中身（問題）は持たないので、開くと 404 になる */
  questionSets?: QuestionSetSummary[];
  /** 中身まで持つ問題セット。一覧にも出る */
  questionSetDetails?: QuestionSetDetail[];
}

/**
 * 画面のテスト用の、偽の API。グローバルの fetch を差し替えて、Better Auth（/api/auth/*）と
 * 問題セットの HTTP API（/api/question-sets）に答える。作成と更新の本文は、本物と同じく questionSetSchema で確かめ、
 * 通らなければ 400 を返す。Better Auth のクライアントも fetch を通るので、
 * 本物のクライアントの要求の形のまま確かめられる。
 *
 * テストの終わりに vi.unstubAllGlobals() で戻す（setup.ts）。
 */
export function stubFakeApi({ hostName = 'XeicuLy', questionSets = [], questionSetDetails = [] }: FakeApiOptions = {}) {
  const state = {
    hostName,
    questionSets: [...questionSetDetails.map((set) => summaryOf(set.id, set)), ...questionSets],
    details: new Map(questionSetDetails.map((set) => [set.id, set])),
  };
  const received: ReceivedRequest[] = [];
  let nextId = 1;

  async function handle(method: string, path: string, body: unknown): Promise<Response> {
    if (path === '/api/auth/get-session') {
      // Better Auth はログインしていないとき、本文 null を 200 で返す
      return Response.json(
        state.hostName === null ? null : { user: { id: 'user-1', name: state.hostName }, session: { id: 'session-1' } },
      );
    }
    if (path === '/api/auth/sign-in/social') {
      return Response.json({ url: 'https://github.com/login/oauth/authorize?state=test', redirect: true });
    }
    if (path === '/api/auth/sign-out') {
      state.hostName = null;
      return Response.json({ success: true });
    }
    if (state.hostName === null) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (path === '/api/question-sets' && method === 'GET') {
      return Response.json({ questionSets: state.questionSets });
    }
    if (path === '/api/question-sets' && method === 'POST') {
      const input = questionSetSchema.safeParse(body);
      if (!input.success) {
        return Response.json({ error: 'invalid_request' }, { status: 400 });
      }
      const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
      state.details.set(id, { id, ...input.data });
      state.questionSets.unshift(summaryOf(id, input.data));
      return Response.json({ id }, { status: 201 });
    }
    const setId = /^\/api\/question-sets\/([^/]+)$/.exec(path)?.[1];
    const detail = setId === undefined ? undefined : state.details.get(setId);
    if (setId !== undefined && method === 'GET' && detail !== undefined) {
      return Response.json(detail);
    }
    if (setId !== undefined && method === 'PUT' && detail !== undefined) {
      const input = questionSetSchema.safeParse(body);
      if (!input.success) {
        return Response.json({ error: 'invalid_request' }, { status: 400 });
      }
      state.details.set(setId, { id: setId, ...input.data });
      // 一覧は更新の新しい順なので、先頭へ移す
      state.questionSets = [summaryOf(setId, input.data), ...state.questionSets.filter((set) => set.id !== setId)];
      return new Response(null, { status: 204 });
    }
    if (setId !== undefined && method === 'DELETE') {
      const before = state.questionSets.length;
      state.questionSets = state.questionSets.filter((set) => set.id !== setId);
      state.details.delete(setId);
      return state.questionSets.length < before
        ? new Response(null, { status: 204 })
        : Response.json({ error: 'not_found' }, { status: 404 });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(new URL(input instanceof Request ? input.url : input, 'http://localhost:3000'), init);
    const text = await request.text();
    const body: unknown = text === '' ? undefined : JSON.parse(text);
    const path = new URL(request.url).pathname;
    received.push({ method: request.method, path, body });
    return handle(request.method, path, body);
  };
  vi.stubGlobal('fetch', fakeFetch);

  return {
    received,
    /** 受け取った要求のうち、その経路のもの */
    requestsTo: (method: string, path: string) => received.filter((r) => r.method === method && r.path === path),
    /** サーバー側でセッションが切れたことにする */
    expireSession: () => {
      state.hostName = null;
    },
  };
}

function summaryOf(id: string, set: { title: string; questions: unknown[] }): QuestionSetSummary {
  return { id, title: set.title, questionCount: set.questions.length, updatedAt: new Date().toISOString() };
}
