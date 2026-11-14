import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { stubFakeApi } from '../../../test/fake-api';
import { GithubSignInButton } from './GithubSignInButton';
import { useGithubSignIn } from './use-github-sign-in';

const GITHUB_URL = 'https://github.com/login/oauth/authorize?state=test';

/** 呼ぶ側と同じ組み方。始められなかったときの文は、呼ぶ側が出す */
function SignIn() {
  const signIn = useGithubSignIn();
  return (
    <>
      <GithubSignInButton signIn={signIn}>GitHub でログイン</GithubSignInButton>
      {signIn.startError !== null && <p role="alert">始められませんでした</p>}
    </>
  );
}

/**
 * jsdom は移動できないので、GitHub へ移る呼び出しだけを受け取る。jsdom の location.assign は上書きできない
 * （vi.spyOn は Cannot redefine property になる）ので、location ごと差し替える。setup.ts の vi.unstubAllGlobals() で戻る
 */
function stubAssign() {
  const assign = vi.fn<(url: string) => void>();
  vi.stubGlobal('location', { ...window.location, assign });
  return assign;
}

describe('GitHub のログインのボタン', () => {
  it('押すと GitHub へ移り、移るあいだはもう押せない', async () => {
    stubFakeApi({ hostName: null });
    const assign = stubAssign();
    render(<SignIn />);

    fireEvent.click(screen.getByRole('button', { name: 'GitHub でログイン' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(GITHUB_URL));
    expect(screen.getByRole('button', { name: 'GitHub でログイン' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('始められなければ、呼ぶ側に失敗を渡し、もう一度押せる', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 500 }));
    const assign = stubAssign();
    render(<SignIn />);

    fireEvent.click(screen.getByRole('button', { name: 'GitHub でログイン' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('始められませんでした');
    expect(screen.getByRole('button', { name: 'GitHub でログイン' })).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
  });
});
