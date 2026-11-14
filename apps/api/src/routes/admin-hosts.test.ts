import { hostSchema, listHostsResponseSchema } from '@zubatto-quiz/protocol';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDb } from '@/db';
import { hostAllowlist } from '@/db/schema';

import { stubGithub, stubGithubUsers } from '../../test/github-stub';
import { apiRequest, apiRequestAs, loginAs, resetHosts } from '../../test/host-request';

// admin（1000・管理者）・alice（1001）・mallory（1002）の3人
beforeEach(resetHosts);
afterEach(() => vi.restoreAllMocks());

const requestAs = (userId: string, method: string, path: string, body?: unknown) =>
  apiRequestAs(userId, method, `/admin/hosts${path}`, body);

const listAsAdmin = async () => listHostsResponseSchema.parse(await (await requestAs('admin', 'GET', '')).json()).hosts;

// 守り（匿名は 401、一般のホストは 403、管理者は通る）は、すべての経路を test/admin-routes.test.ts で確かめる

describe('GET /api/admin/hosts（ADR 0013）', () => {
  it('許可リストを、足した順に返す', async () => {
    const response = await requestAs('admin', 'GET', '');

    expect(response.status).toBe(200);
    const { hosts } = listHostsResponseSchema.parse(await response.json());
    expect(hosts.map(({ githubUserId, isAdmin }) => ({ githubUserId, isAdmin }))).toEqual([
      { githubUserId: '1000', isAdmin: true },
      { githubUserId: '1001', isAdmin: false },
      { githubUserId: '1002', isAdmin: false },
    ]);
  });
});

describe('POST /api/admin/hosts（ADR 0013）', () => {
  it('GitHub の名前を数値の ID に変えて許可リストに入れ、GitHub が返した名前を note に入れて 201 で返す', async () => {
    const github = stubGithubUsers({ Octocat: { id: 583231 } });

    const response = await requestAs('admin', 'POST', '', { login: 'Octocat' });

    expect(response.status).toBe(201);
    const host = hostSchema.parse(await response.json());
    expect(host).toEqual({ githubUserId: '583231', note: 'Octocat', isAdmin: false, createdAt: expect.any(String) });
    expect(await listAsAdmin()).toContainEqual(host);
    expect(github.requests.map((request) => request.url)).toEqual(['https://api.github.com/users/Octocat']);
  });

  it.each([
    ['login がない', {}],
    ['形の違う名前（経路を書き換える）', { login: '../orgs/x' }],
    ['40文字の名前', { login: 'x'.repeat(40) }],
  ])('%s なら、GitHub に送らずに 400 を返す', async (_, body) => {
    const github = stubGithubUsers({});

    const response = await requestAs('admin', 'POST', '', body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
    expect(github.requests).toEqual([]);
  });

  it.each([
    ['GitHub にない名前', {}],
    ['Organization', { nobody: { id: 9919, type: 'Organization' as const } }],
  ])('%s なら 404 を返し、許可リストを変えない', async (_, users) => {
    stubGithubUsers(users);

    const response = await requestAs('admin', 'POST', '', { login: 'nobody' });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(await listAsAdmin()).toHaveLength(3);
  });

  it('すでに許可リストにいる人なら 409 already_exists を返し、行を変えない', async () => {
    stubGithubUsers({ alice: { id: 1001 } });
    const before = await listAsAdmin();

    const response = await requestAs('admin', 'POST', '', { login: 'alice' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'already_exists' });
    expect(await listAsAdmin()).toEqual(before);
  });

  it('同じ人を同時に2回足しても、許可リストは1行で、片方は 409 になる', async () => {
    stubGithubUsers({ octocat: { id: 583231 } });

    const statuses = await Promise.all(
      [0, 1].map(async () => (await requestAs('admin', 'POST', '', { login: 'octocat' })).status),
    );

    expect(statuses.sort()).toEqual([201, 409]);
    expect((await listAsAdmin()).filter((host) => host.githubUserId === '583231')).toHaveLength(1);
  });

  it.each([403, 429, 500])('GitHub が %i を返したら 502 github_unavailable を返す', async (status) => {
    stubGithub(() => Response.json({ message: 'error' }, { status }));

    const response = await requestAs('admin', 'POST', '', { login: 'octocat' });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'github_unavailable' });
  });

  it('GitHub が時間切れなら 502 github_unavailable を返す', async () => {
    stubGithub(() => {
      throw new DOMException('timeout', 'TimeoutError');
    });

    const response = await requestAs('admin', 'POST', '', { login: 'octocat' });

    expect(response.status).toBe(502);
  });

  it('別のオリジンからのフォームの形の要求は、csrf() が 403（テキスト）で断り、GitHub に送らない', async () => {
    const github = stubGithubUsers({ octocat: { id: 583231 } });
    const headers = await loginAs('admin');
    headers.set('origin', 'https://evil.example');
    headers.set('content-type', 'application/x-www-form-urlencoded');

    const response = await apiRequest('/admin/hosts', { method: 'POST', headers, body: 'login=octocat' });

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(github.requests).toEqual([]);
  });
});

describe('DELETE /api/admin/hosts/:githubUserId（ADR 0013）', () => {
  it('ホストを外して 204 を返す。その人の既存のセッションは、次の要求から 401 になる', async () => {
    const alice = await loginAs('alice');
    expect((await apiRequest('/question-sets', { headers: alice })).status).toBe(200);

    const response = await requestAs('admin', 'DELETE', '/1001');

    expect(response.status).toBe(204);
    expect((await listAsAdmin()).map((host) => host.githubUserId)).toEqual(['1000', '1002']);
    const after = await apiRequest('/question-sets', { headers: alice });
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: 'unauthorized' });
  });

  it('外した人を足し直しても、外す前のセッションは 401 のまま', async () => {
    const alice = await loginAs('alice');
    stubGithubUsers({ alice: { id: 1001 } });

    expect((await requestAs('admin', 'DELETE', '/1001')).status).toBe(204);
    expect((await requestAs('admin', 'POST', '', { login: 'alice' })).status).toBe(201);

    // 外すときにセッションを消しているので、足し直しても戻らない
    expect((await apiRequest('/question-sets', { headers: alice })).status).toBe(401);
  });

  it.each([
    ['自分', '1000'],
    ['ほかの管理者', '1002'],
  ])('管理者の行（%s）は外さず 409 admin_host を返す。その人のセッションも残る', async (_, githubUserId) => {
    await createDb(env.DB).update(hostAllowlist).set({ isAdmin: true }).where(eq(hostAllowlist.githubUserId, '1002'));
    const mallory = await loginAs('mallory');

    const response = await requestAs('admin', 'DELETE', `/${githubUserId}`);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'admin_host' });
    expect(await listAsAdmin()).toHaveLength(3);
    expect((await apiRequest('/question-sets', { headers: mallory })).status).toBe(200);
  });

  it('許可リストにない ID なら 404 を返す', async () => {
    const response = await requestAs('admin', 'DELETE', '/9999');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('本文のない DELETE も、同じオリジンを示さなければ csrf() が断る', async () => {
    const headers = await loginAs('admin');

    const response = await apiRequest('/admin/hosts/1001', { method: 'DELETE', headers });

    expect(response.status).toBe(403);
    expect(await listAsAdmin()).toHaveLength(3);
  });
});
