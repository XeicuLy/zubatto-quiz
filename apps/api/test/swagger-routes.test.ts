import openapi from '@zubatto-quiz/protocol/openapi.json' with { type: 'json' };
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import dev from './dev-entry';
import e2e from './e2e-entry';
import { SWAGGER_UI_PATH } from './swagger-path';

const ORIGIN = env.BETTER_AUTH_URL;

// どちらの入口も addSwaggerRoutes で同じ経路を足す。片方だけ書き方がずれていないことを、両方に同じテストを当てて確かめる
describe.each([
  { name: 'E2E の入口', entry: e2e },
  { name: '開発の入口', entry: dev },
])('Swagger UI（ADR 0011）: $name', ({ entry }) => {
  const request = (path: string) => entry.request(`${ORIGIN}${path}`, undefined, env);

  it('UI の HTML を返し、版を固定した Swagger UI に、同じ入口の仕様を読ませる', async () => {
    const response = await request(SWAGGER_UI_PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    const page = await response.text();
    expect(page).toContain('https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1/swagger-ui-bundle.js');
    expect(page).toContain(`url: "${SWAGGER_UI_PATH}/openapi.json"`);
  });

  it('仕様は、コミットした openapi.json をそのまま返す', async () => {
    const response = await request(`${SWAGGER_UI_PATH}/openapi.json`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(openapi);
  });
});
