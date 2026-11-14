import { useState } from 'react';

import { githubSignInUrl } from '@/api/auth-client';

export interface GithubSignIn {
  /** GitHub へ移るあいだ。ボタンを押せなくする */
  starting: boolean;
  /** ログインを始められなかったときに投げられた値。始められたか、まだ押していなければ null */
  startError: unknown;
  signIn: () => Promise<void>;
}

/**
 * GitHub のログインを始める（ADR 0003）。ログインの画面と入口が使う。
 * 始められなかったときの文は、呼ぶ側が置く場所に合わせて出す
 */
export function useGithubSignIn(): GithubSignIn {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);

  async function signIn() {
    setStarting(true);
    setStartError(null);
    try {
      // GitHub へ移る。ページを離れるので、成功したら starting は戻さない
      window.location.assign(await githubSignInUrl());
    } catch (error) {
      setStarting(false);
      setStartError(error);
    }
  }

  return { starting, startError, signIn };
}
