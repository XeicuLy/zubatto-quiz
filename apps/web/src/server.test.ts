// @vitest-environment node
import { describe, expect, it } from 'vitest';

import worker from './server';

/** 受け取った要求を記録し、決まった応答を返す偽の API の Worker */
function createFakeApi() {
  const received: Request[] = [];
  const api = {
    fetch: async (request: Request) => {
      received.push(request);
      return new Response('from api', { status: 200, headers: { 'X-From': 'api' } });
    },
  };
  return { env: { API: api } as unknown as Env, received };
}

async function send(path: string, init?: RequestInit) {
  const { env, received } = createFakeApi();
  // Workers が渡す要求には Cloudflare の cf の情報が付くが、入口はそれを読まないので、ふつうの Request で代える
  const request = new Request(`https://zubakui.example.workers.dev${path}`, init) as Request<
    unknown,
    IncomingRequestCfProperties
  >;
  const response = await worker.fetch(request, env);
  return { response, received };
}

describe('画面の Worker の入口', () => {
  it('/api/ の下の要求を API の Worker へ転送し、その応答をそのまま返す', async () => {
    const { response, received } = await send('/api/health');

    expect(received).toHaveLength(1);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-From')).toBe('api');
    expect(await response.text()).toBe('from api');
  });

  it('転送した要求に、URL・メソッド・本文・Cookie・Origin がそのまま残る（ADR 0003・0006）', async () => {
    const { received } = await send('/api/question-sets?page=2', {
      method: 'POST',
      headers: { Cookie: 'session=abc', Origin: 'https://zubakui.example.workers.dev' },
      body: '{"title":"テスト"}',
    });

    const [forwarded] = received;
    expect(forwarded?.url).toBe('https://zubakui.example.workers.dev/api/question-sets?page=2');
    expect(forwarded?.method).toBe('POST');
    expect(forwarded?.headers.get('Cookie')).toBe('session=abc');
    expect(forwarded?.headers.get('Origin')).toBe('https://zubakui.example.workers.dev');
    expect(await forwarded?.text()).toBe('{"title":"テスト"}');
  });

  it('WebSocket の Upgrade の要求も、ヘッダーを保ったまま転送する', async () => {
    const { received } = await send('/api/rooms/room-1/ws', {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });

    expect(received[0]?.headers.get('Upgrade')).toBe('websocket');
  });

  it.each([
    '/api',
    '/apis/health',
    '/api-docs',
    '/admin',
    '/',
    // '..' で /api/ の外へ抜ける経路。URL が '/admin' に正規化するので転送しない
    '/api/../admin',
    '/api/%2e%2e/admin',
  ])('%s は転送せず、404 を返す', async (path) => {
    const { response, received } = await send(path);

    expect(received).toHaveLength(0);
    expect(response.status).toBe(404);
  });
});
