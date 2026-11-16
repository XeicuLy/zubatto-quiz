import { QueryClient } from '@tanstack/react-query';
import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/errors';

import { stubFakeApi } from '../../../test/fake-api';
import { requireAdmin } from './require-admin';

/** 投げた redirect の行き先。redirect でなければ投げ直す */
async function redirectTarget(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (thrown) {
    if (isRedirect(thrown)) return thrown.options.to;
    throw thrown;
  }
  return null;
}

describe('requireAdmin（ADR 0013）', () => {
  it('管理者なら、そのまま通す', async () => {
    stubFakeApi({ isAdmin: true });

    expect(await redirectTarget(requireAdmin({ context: { queryClient: new QueryClient() } }))).toBeNull();
  });

  it('管理者でなければ、問題セットの一覧へ移す', async () => {
    stubFakeApi({ isAdmin: false });

    expect(await redirectTarget(requireAdmin({ context: { queryClient: new QueryClient() } }))).toBe('/admin');
  });

  it('セッションが切れていたら（401）、ログイン画面へ移す', async () => {
    stubFakeApi({ hostName: null });

    expect(await redirectTarget(requireAdmin({ context: { queryClient: new QueryClient() } }))).toBe('/login');
  });

  it('前に管理者と覚えていても、読み直して確かめる。印をコマンドで外したあとは通さない', async () => {
    const queryClient = new QueryClient();
    stubFakeApi({ isAdmin: true });
    await requireAdmin({ context: { queryClient } });

    const api = stubFakeApi({ isAdmin: false });

    expect(await redirectTarget(requireAdmin({ context: { queryClient } }))).toBe('/admin');
    expect(api.requestsTo('GET', '/api/me')).toHaveLength(1);
  });

  it('それ以外の失敗は、そのまま投げる（ルートのエラーの画面が出る）', async () => {
    // 5xx はやり直して時間がかかるので、やり直さない 4xx で確かめる
    vi.stubGlobal('fetch', async () => Response.json({ error: 'forbidden' }, { status: 403 }));

    await expect(requireAdmin({ context: { queryClient: new QueryClient() } })).rejects.toEqual(
      new ApiError(403, 'forbidden'),
    );
  });
});
