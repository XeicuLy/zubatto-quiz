import { Card } from '@/components/ui/card';
import { GithubSignInButton } from '@/shared/auth/GithubSignInButton';
import { useGithubSignIn } from '@/shared/auth/use-github-sign-in';

/** 許可リストの外で拒否されたときに、Better Auth が ?error= に入れる値（apps/api の HOST_NOT_ALLOWED） */
const HOST_NOT_ALLOWED = 'host_not_allowed';

interface LoginPageProps {
  /** GitHub のログインから戻ってきたときの ?error= の値 */
  error: string | undefined;
}

/**
 * ホストのログイン（ADR 0003）。GitHub でログインし、許可リストにいる人だけがホストになれる。
 * 拒否されると Better Auth が ?error= を付けてここへ戻すので、その理由を出す
 */
export function LoginPage({ error }: LoginPageProps) {
  const signIn = useGithubSignIn();
  const startFailed = signIn.startError !== null;
  const denied = error === HOST_NOT_ALLOWED;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-16">
      <p className="font-logo text-display">ズバクイ</p>
      <h1 className="mt-2 text-heading font-bold">ホストの管理画面</h1>

      {denied ? (
        <Card variant="destructive" role="alert" className="mt-8">
          <p className="font-bold text-phrase text-destructive">このアカウントはホストとして登録されていません</p>
          <p className="mt-2 text-body">
            ホストになるには、開発者に GitHub のアカウントを伝えて、許可リストに入れてもらってください。
          </p>
          <p className="mt-2 text-note text-muted-foreground">
            別のアカウントでログインするときは、先に GitHub でそのアカウントに切り替えてください。
          </p>
        </Card>
      ) : error !== undefined || startFailed ? (
        <Card variant="destructive" role="alert" className="mt-8">
          <p className="font-bold text-destructive">ログインできませんでした</p>
          <p className="mt-2 text-body">少し待ってから、もう一度ログインしてください。</p>
        </Card>
      ) : (
        <p className="mt-6 text-body text-muted-foreground">
          問題セットを作り、部屋を作って進行します。ホストとして登録された GitHub アカウントでログインしてください。
        </p>
      )}

      <GithubSignInButton signIn={signIn} variant={denied ? 'outline' : 'default'} className="mt-8">
        {denied ? '別のアカウントでログイン' : 'GitHub でログイン'}
      </GithubSignInButton>
      <p className="mt-6 text-note text-muted-foreground">
        クイズに答えるだけなら、ログインは要りません。ホストから届いた URL を開いてください。
      </p>
    </main>
  );
}
