import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '@/index';

import { stubGithubUsers } from './github-stub';
import { apiRequest, apiRequestAs, ORIGIN, resetHosts } from './host-request';

/**
 * 管理者だけの経路（/api/admin/*）の守りを、すべての経路で確かめる（ADR 0013）。
 *
 * 経路は app.routes から拾うので、/api/admin/ の下にルートを足すと、ここに要求の例を書くまでテストが落ちる。
 * 例を書けば、匿名は 401、一般のホストは 403、管理者は通ることを確かめる。守り（requireAdmin）を付け忘れると、一般のホストが通って落ちる。
 * 要求の例は、管理者なら成功する形にする。成功の中身は、経路ごとのテスト（src/routes/admin-hosts.test.ts）で確かめる
 */
const EXAMPLES: Record<string, { path: string; body?: unknown }> = {
  'GET /api/admin/hosts': { path: '/admin/hosts' },
  'POST /api/admin/hosts': { path: '/admin/hosts', body: { login: 'octocat' } },
  'DELETE /api/admin/hosts/:githubUserId': { path: '/admin/hosts/1001' },
};

/** app.routes にある /api/admin/ の下の操作。.use() のミドルウェア（ALL）とバリデーターの重なりは除く */
const adminOperations = [
  ...new Set(
    app.routes
      .filter((route) => route.method !== 'ALL' && route.path.startsWith('/api/admin/'))
      .map((route) => `${route.method} ${route.path}`),
  ),
].sort();

beforeEach(async () => {
  await resetHosts();
  stubGithubUsers({ octocat: { id: 583231 } });
});
afterEach(() => vi.restoreAllMocks());

describe('管理者だけの経路の守り（ADR 0013）', () => {
  it('/api/admin/ の下のすべての経路に、要求の例がある', () => {
    expect(adminOperations.length).toBeGreaterThan(0);
    expect(
      adminOperations.filter((operation) => !Object.hasOwn(EXAMPLES, operation)),
      '/api/admin/ の下にルートを足したら、EXAMPLES に要求の例を足す',
    ).toEqual([]);
    // 消したルートの例が残っていれば、それも落とす
    expect(Object.keys(EXAMPLES).sort()).toEqual(adminOperations);
  });

  describe.each(Object.entries(EXAMPLES))('%s', (operation, { path, body }) => {
    const method = operation.split(' ')[0] ?? '';

    it('ログインしていなければ 401 を返す', async () => {
      // 同じオリジンの画面からの要求にして、csrf() ではなく requireHost で止まることを見る
      const response = await apiRequest(path, {
        method,
        headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
    });

    it('管理者でないホストには 403 forbidden を返す', async () => {
      const response = await apiRequestAs('alice', method, path, body);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'forbidden' });
    });

    it('管理者は通る', async () => {
      const response = await apiRequestAs('admin', method, path, body);

      expect(response.status).toBeLessThan(300);
    });
  });
});
