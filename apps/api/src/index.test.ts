import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('GET /api/health', () => {
  it('200 と { ok: true } を返す', async () => {
    const response = await exports.default.fetch('https://example.com/api/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('/api/ の外の経路は 404 を返す', async () => {
    const response = await exports.default.fetch('https://example.com/health');

    expect(response.status).toBe(404);
  });
});

describe('D1 の binding（DB）', () => {
  it('書いた行を読み戻せる', async () => {
    await env.DB.exec('CREATE TABLE probe (value TEXT NOT NULL)');
    await env.DB.prepare('INSERT INTO probe (value) VALUES (?)').bind('hello').run();

    const row = await env.DB.prepare('SELECT value FROM probe').first<{ value: string }>();

    expect(row).toEqual({ value: 'hello' });
  });
});
