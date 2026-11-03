import { describe, expect, it } from 'vitest';

import { stubFakeApi } from '../../test/fake-api';
import { fetchHostSession, githubSignInUrl, signOut } from './auth-client';

describe('fetchHostSession', () => {
  it('ログインしていれば、ホストの名前を返す', async () => {
    stubFakeApi({ hostName: 'XeicuLy' });

    expect(await fetchHostSession()).toEqual({ name: 'XeicuLy' });
  });

  it('ログインしていなければ null を返す', async () => {
    stubFakeApi({ hostName: null });

    expect(await fetchHostSession()).toBeNull();
  });
});

describe('githubSignInUrl', () => {
  it('ログインのあとは /admin へ、拒否されたら /login へ戻るよう頼み、GitHub の URL を返す（ADR 0003）', async () => {
    const api = stubFakeApi({ hostName: null });

    const url = await githubSignInUrl();

    expect(url).toBe('https://github.com/login/oauth/authorize?state=test');
    expect(api.requestsTo('POST', '/api/auth/sign-in/social')).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({ provider: 'github', callbackURL: '/admin', errorCallbackURL: '/login' }),
      }),
    ]);
  });
});

describe('signOut', () => {
  it('ログアウトの要求を送る', async () => {
    const api = stubFakeApi();

    await signOut();

    expect(api.requestsTo('POST', '/api/auth/sign-out')).toHaveLength(1);
    expect(await fetchHostSession()).toBeNull();
  });
});
