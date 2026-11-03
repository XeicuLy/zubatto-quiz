import { createAuthClient } from 'better-auth/client';

/**
 * ホストのログイン（ADR 0003）。画面から Better Auth に触るのはこのファイルだけにする。
 *
 * Better Auth は TypeScript 専用なので、Go へ置き換えるときはなくなる（ADR 0001・0003）。
 * 画面のほかの場所はここの3つの関数だけを使うので、置き換えのときは、このファイルの中身を直せば済む。
 */

// 画面と API は同じオリジンにある（ADR 0006）。baseURL を省くと、location.origin の /api/auth を使う
const authClient = createAuthClient({
  // Better Auth は作った時点の fetch をつかむので、呼ぶたびにグローバルの fetch を引く。
  // テストが差し替えた fetch（test/fake-api.ts）を通すため。本番の動きは変わらない
  fetchOptions: { customFetchImpl: (input, init) => fetch(input, init) },
});

export interface HostSession {
  name: string;
}

/**
 * ログインしているホストを返す。ログインしていなければ null。
 * 画面で確かめるのは、ホスト以外に管理画面を見せないためだけ。守りの本体は API の requireHost にある（S1）
 */
export async function fetchHostSession(): Promise<HostSession | null> {
  const { data, error } = await authClient.getSession();
  if (error) {
    throw new Error(`セッションを読めなかった（${error.status}）`);
  }
  return data ? { name: data.user.name } : null;
}

/**
 * GitHub のログインを始め、移る先の GitHub の URL を返す。
 * 許可リストの外で拒否されると、Better Auth は /login?error=host_not_allowed へ戻す（ADR 0003）。
 * 移るのは呼ぶ側で行う。Better Auth に任せると、テストの jsdom で移れない
 */
export async function githubSignInUrl(): Promise<string> {
  const { data, error } = await authClient.signIn.social({
    provider: 'github',
    callbackURL: '/admin',
    errorCallbackURL: '/login',
    disableRedirect: true,
  });
  if (error || !data.url) {
    throw new Error(`ログインを始められなかった（${error?.status}）`);
  }
  return data.url;
}

export async function signOut(): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) {
    throw new Error(`ログアウトできなかった（${error.status}）`);
  }
}
