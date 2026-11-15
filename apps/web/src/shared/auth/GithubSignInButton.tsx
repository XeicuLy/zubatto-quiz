import type { ComponentProps, ReactNode } from 'react';

import { GitHubMark } from '@/components/icons/github-mark';
import { Button } from '@/components/ui/button';

import type { GithubSignIn } from './use-github-sign-in';

type ButtonProps = ComponentProps<typeof Button>;

interface GithubSignInButtonProps {
  /** useGithubSignIn の戻り値。押すとログインを始め、GitHub へ移るあいだは押せなくする */
  signIn: GithubSignIn;
  variant?: ButtonProps['variant'];
  className?: string;
  children: ReactNode;
}

/** GitHub のマークを付けた、ログインを始める大きいボタン */
export function GithubSignInButton({ signIn, variant = 'default', className, children }: GithubSignInButtonProps) {
  return (
    <Button variant={variant} size="lg" onClick={signIn.signIn} disabled={signIn.starting} className={className}>
      <GitHubMark />
      {children}
    </Button>
  );
}
