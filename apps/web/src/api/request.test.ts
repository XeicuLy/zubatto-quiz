import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from './errors';
import { request } from './request';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubResponse(response: Response) {
  vi.stubGlobal('fetch', () => Promise.resolve(response));
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('投げなかった');
}

describe('request', () => {
  it('2xx なら応答をそのまま返す', async () => {
    stubResponse(Response.json({ ok: true }));

    const response = await request('GET', '/api/question-sets');

    expect(await response.json()).toEqual({ ok: true });
  });

  it('2xx 以外で本文が protocol のエラーの形なら、状態コードと一緒にそのコードを持たせる', async () => {
    stubResponse(Response.json({ error: 'not_found' }, { status: 404 }));

    const error = await caught(request('GET', '/api/question-sets/x'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'not_found' });
  });

  it('本文が JSON でなければ（csrf() の 403 など）、コードは null にする', async () => {
    stubResponse(new Response('Forbidden', { status: 403 }));

    const error = await caught(request('PUT', '/api/question-sets/x', {}));

    expect(error).toMatchObject({ status: 403, code: null });
  });

  it('JSON でも protocol の形でなければ、コードは null にする', async () => {
    stubResponse(Response.json({ error: 'teapot' }, { status: 502 }));

    const error = await caught(request('GET', '/api/question-sets'));

    expect(error).toMatchObject({ status: 502, code: null });
  });
});
