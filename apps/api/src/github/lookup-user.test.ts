import { afterEach, describe, expect, it, vi } from 'vitest';

import { githubUser, stubGithub, stubGithubUsers } from '../../test/github-stub';
import { lookupGithubUser } from './lookup-user';

afterEach(() => vi.restoreAllMocks());

describe('lookupGithubUser（ADR 0013）', () => {
  it('User なら、数値の ID を文字列にして返す', async () => {
    stubGithubUsers({ octocat: { id: 583231 } });

    expect(await lookupGithubUser('octocat')).toEqual({ kind: 'found', githubUserId: '583231', login: 'octocat' });
  });

  it('名前は GitHub が返した書き方にする（大文字と小文字は GitHub が見分けない）', async () => {
    stubGithub(() => githubUser(583231, 'Octocat'));

    expect(await lookupGithubUser('octocat')).toMatchObject({ login: 'Octocat' });
  });

  it('送り先は api.github.com の /users/ だけで、User-Agent と待つ時間の区切りを付ける', async () => {
    const github = stubGithubUsers({ octocat: { id: 583231 } });

    await lookupGithubUser('octocat');

    expect(github.requests.map((request) => request.url)).toEqual(['https://api.github.com/users/octocat']);
    const [request] = github.requests;
    expect(request?.method).toBe('GET');
    expect(request?.headers.get('user-agent')).toBe('zubakui-api');
    expect(request?.headers.get('accept')).toBe('application/vnd.github+json');
    expect(request?.signal.aborted).toBe(false);
  });

  it('前後の空白を取り除いてから問い合わせる', async () => {
    const github = stubGithubUsers({ octocat: { id: 583231 } });

    expect(await lookupGithubUser(' octocat ')).toMatchObject({ kind: 'found' });
    expect(github.requests.map((request) => request.url)).toEqual(['https://api.github.com/users/octocat']);
  });

  it.each(['octocat/repos', '..', '%2e%2e', 'octocat?x=1', 'a'.repeat(40), ''])(
    '形の違う名前（%s）は GitHub に送らず、見つからない扱いにする',
    async (login) => {
      const github = stubGithubUsers({});

      expect(await lookupGithubUser(login)).toEqual({ kind: 'notFound' });
      expect(github.requests).toEqual([]);
    },
  );

  it('GitHub の 404 は見つからない', async () => {
    stubGithubUsers({});

    expect(await lookupGithubUser('nobody')).toEqual({ kind: 'notFound' });
  });

  it('Organization は、ホストにできないので見つからない扱いにする', async () => {
    stubGithubUsers({ github: { id: 9919, type: 'Organization' } });

    expect(await lookupGithubUser('github')).toEqual({ kind: 'notFound' });
  });

  it.each([403, 429, 500, 502, 503])('GitHub の %i は不調として返す', async (status) => {
    stubGithub(() => Response.json({ message: 'API rate limit exceeded' }, { status }));

    expect(await lookupGithubUser('octocat')).toEqual({ kind: 'unavailable' });
  });

  it('時間切れや通信の失敗は不調として返す', async () => {
    stubGithub(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });

    expect(await lookupGithubUser('octocat')).toEqual({ kind: 'unavailable' });
  });

  it.each([
    ['JSON でない', () => new Response('<html>', { status: 200 })],
    ['id がない', () => Response.json({ login: 'octocat', type: 'User' })],
    ['id が数でない', () => Response.json({ id: '583231', login: 'octocat', type: 'User' })],
  ])('200 でも形の違う応答（%s）は不調として返す', async (_, respond) => {
    stubGithub(respond);

    expect(await lookupGithubUser('octocat')).toEqual({ kind: 'unavailable' });
  });
});
