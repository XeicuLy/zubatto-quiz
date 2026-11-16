import type { Host } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { stubFakeApi } from '../../test/fake-api';
import { ApiError } from './errors';
import { addHost, fetchHosts, removeHost } from './hosts';
import { fetchMe } from './me';

const ADMIN: Host = { githubUserId: '1000', note: 'XeicuLy', isAdmin: true, createdAt: '2026-11-01T03:00:00.000Z' };
const ALICE: Host = { githubUserId: '1001', note: 'alice', isAdmin: false, createdAt: '2026-11-02T03:00:00.000Z' };

describe('fetchMe', () => {
  it.each([true, false])('管理者か（isAdmin: %s）を返す（ADR 0013）', async (isAdmin) => {
    stubFakeApi({ isAdmin });

    expect(await fetchMe()).toEqual({ isAdmin });
  });

  it('ログインが切れていたら、401 の ApiError を投げる', async () => {
    stubFakeApi({ hostName: null });

    await expect(fetchMe()).rejects.toEqual(new ApiError(401, 'unauthorized'));
  });
});

describe('fetchHosts', () => {
  it('許可リストを、足した順に返す', async () => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN, ALICE] });

    expect(await fetchHosts()).toEqual([ADMIN, ALICE]);
  });

  it('管理者でなければ、403 forbidden の ApiError を投げる', async () => {
    stubFakeApi({ isAdmin: false, hosts: [ADMIN] });

    await expect(fetchHosts()).rejects.toEqual(new ApiError(403, 'forbidden'));
  });
});

describe('addHost', () => {
  it('GitHub の名前を送り、足した行を返す', async () => {
    const api = stubFakeApi({ isAdmin: true, hosts: [ADMIN], githubUsers: { octocat: '583231' } });

    const added = await addHost('octocat');

    expect(added).toEqual({ githubUserId: '583231', note: 'octocat', isAdmin: false, createdAt: expect.any(String) });
    expect(api.requestsTo('POST', '/api/admin/hosts')).toEqual([
      expect.objectContaining({ body: { login: 'octocat' } }),
    ]);
    expect(await fetchHosts()).toEqual([ADMIN, added]);
  });

  it.each([
    ['GitHub にいない', { githubUsers: {} }, new ApiError(404, 'not_found')],
    ['もうホストにいる', { githubUsers: { alice: '1001' } }, new ApiError(409, 'already_exists')],
    ['GitHub が答えない', { githubUnavailable: true }, new ApiError(502, 'github_unavailable')],
  ])('%s なら、その理由の ApiError を投げる', async (_, options, expected) => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN, ALICE], ...options });

    await expect(addHost('alice')).rejects.toEqual(expected);
  });
});

describe('removeHost', () => {
  it('その GitHub ID のホストを外す', async () => {
    const api = stubFakeApi({ isAdmin: true, hosts: [ADMIN, ALICE] });

    await removeHost(ALICE.githubUserId);

    expect(api.requestsTo('DELETE', '/api/admin/hosts/1001')).toHaveLength(1);
    expect(await fetchHosts()).toEqual([ADMIN]);
  });

  it('ID を URL に入れるときは、経路を書き換えないよう符号にする', async () => {
    const api = stubFakeApi({ isAdmin: true, hosts: [ADMIN] });

    await expect(removeHost('../question-sets')).rejects.toEqual(new ApiError(404, 'not_found'));

    expect(api.received.at(-1)?.path).toBe('/api/admin/hosts/..%2Fquestion-sets');
  });
});
