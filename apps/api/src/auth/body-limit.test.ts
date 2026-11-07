import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const BASE_URL = env.BETTER_AUTH_URL;
const SIGN_IN_URL = `${BASE_URL}/api/auth/sign-in/social`;
const LIMIT_BYTES = 4 * 1024;

const validBody = JSON.stringify({ provider: 'github', callbackURL: '/admin', errorCallbackURL: '/login' });

/** 不正な要素を並べた本文。zod は要素ごとに誤りを作るので、検査まで届くとメモリを使う */
const bodyWithInvalidScopes = (count: number) =>
  JSON.stringify({ provider: 'github', scopes: Array.from({ length: count }, () => 1) });

/** ちょうど size バイトの本文。空白は JSON として正しい */
const paddedBody = (size: number) => validBody + ' '.repeat(size - validBody.length);

const post = (body: BodyInit) =>
  exports.default.fetch(SIGN_IN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE_URL },
    body,
  });

/** Content-Length の付かない本文。1バイトずつではなく、途中で分けて流す */
const streamOf = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  const middle = Math.floor(bytes.length / 2);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, middle));
      controller.enqueue(bytes.slice(middle));
      controller.close();
    },
  });
};

describe('/api/auth/* の本文の上限', () => {
  it('上限を超えた本文は、検査の前に 413 で止める', async () => {
    const response = await post(bodyWithInvalidScopes(300_000));

    expect(response.status).toBe(413);
  });

  it('Content-Length のない本文も、上限を超えたら 413 で止める', async () => {
    const response = await post(streamOf(bodyWithInvalidScopes(300_000)));

    expect(response.status).toBe(413);
  });

  it.each([
    ['ちょうど上限', LIMIT_BYTES, 200],
    ['上限を1バイト超える', LIMIT_BYTES + 1, 413],
  ])('%s（%i バイト）の本文は %i になる', async (_, size, status) => {
    const response = await post(paddedBody(size));

    expect(response.status).toBe(status);
  });

  it('画面が送るログインの本文は通る', async () => {
    const response = await post(validBody);

    expect(response.status).toBe(200);
    expect(await response.json<{ url: string }>()).toMatchObject({ url: expect.stringContaining('github.com') });
  });

  it('Content-Length のない本文でも、上限の内なら Better Auth まで届く', async () => {
    const response = await post(streamOf(validBody));

    expect(response.status).toBe(200);
    expect(await response.json<{ url: string }>()).toMatchObject({ url: expect.stringContaining('github.com') });
  });

  it('gzip の本文は展開されないので、圧縮で上限をすり抜けても検査まで届かない', async () => {
    // bodyLimit が数えるのは届いたバイト数。展開されるようになると、この本文は検査まで届き、ここが落ちる
    const compressed = new Uint8Array(
      await new Response(
        new Blob([bodyWithInvalidScopes(300_000)]).stream().pipeThrough(new CompressionStream('gzip')),
      ).arrayBuffer(),
    );
    expect(compressed.length).toBeLessThan(LIMIT_BYTES);

    const response = await exports.default.fetch(SIGN_IN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL, 'content-encoding': 'gzip' },
      body: compressed,
    });

    expect(response.status).toBe(400);
    expect(await response.json<{ code: string }>()).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('本文のないセッションの取得は止めない', async () => {
    const response = await exports.default.fetch(`${BASE_URL}/api/auth/get-session`);

    expect(response.status).toBe(200);
  });
});
