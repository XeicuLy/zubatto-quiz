import { vi } from 'vitest';

/**
 * GitHub の API（api.github.com）への fetch を差し替え、呼ばれた URL とヘッダーを覚える（ADR 0013）。
 *
 * vitest-plugin では、テストと exports.default.fetch で呼んだ Worker が同じ isolate で動くので、
 * globalThis.fetch を差し替えればルートの中の呼び出しにも効く。テストから API への要求（exports.default.fetch）は差し替えない。
 * 外へは1回も出さないので、答えを決めていない要求が来たらテストを落とす
 */
export interface GithubStub {
  /** 呼ばれた順の要求 */
  readonly requests: readonly Request[];
}

/** GitHub の GET /users/{username} の応答のうち、Worker が読む項目 */
export const githubUser = (id: number, login: string, type: 'User' | 'Organization' = 'User') =>
  Response.json({ id, login, type, name: null });

/**
 * fetch を差し替える。respond は要求ごとの応答を返す。投げれば、fetch がその値で失敗する（時間切れ・通信の失敗）。
 * vi.restoreAllMocks（afterEach）で元に戻す
 */
export function stubGithub(respond: (request: Request) => Response | Promise<Response>): GithubStub {
  const requests: Request[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return respond(request);
  });
  return { requests };
}

/** login ごとの GitHub のユーザー。表にない名前は GitHub と同じく 404 にする */
export const stubGithubUsers = (users: Record<string, { id: number; type?: 'User' | 'Organization' }>) =>
  stubGithub((request) => {
    const login = decodeURIComponent(new URL(request.url).pathname.replace(/^\/users\//, ''));
    const user = Object.hasOwn(users, login) ? users[login] : undefined;
    return user ? githubUser(user.id, login, user.type) : Response.json({ message: 'Not Found' }, { status: 404 });
  });
