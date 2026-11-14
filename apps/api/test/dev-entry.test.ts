import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import dev from './dev-entry';
import { E2E_LOGIN_PATH } from './e2e-login-path';

const ORIGIN = env.BETTER_AUTH_URL;

const request = (path: string, init?: RequestInit) => dev.request(`${ORIGIN}${path}`, init, env);

// Swagger UI の経路は swagger-routes.test.ts で、E2E の入口と同じテストを当てる
describe('開発の入口（vite dev）', () => {
  it('本番の経路もそのまま通る', async () => {
    const response = await request('/api/health');

    expect(await response.json()).toEqual({ ok: true });
  });

  it('E2E 用のログインの経路はない。開発では本物の GitHub のログインを使う', async () => {
    const response = await request(E2E_LOGIN_PATH, { method: 'POST' });

    expect(response.status).toBe(404);
  });
});
