import { Link } from '@tanstack/react-router';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/tailwind';
import { GithubSignInButton } from '@/shared/auth/GithubSignInButton';
import { useGithubSignIn } from '@/shared/auth/use-github-sign-in';
import { ActionError } from '@/shared/feedback/ActionError';

interface LandingPageProps {
  /** ホストとしてログインしているか。表示を変えるためだけに使う（守りは API の requireHost） */
  signedIn: boolean;
}

/**
 * ゲームの早押しパネルと同じ4色。飾りなので読み上げには入れないが、決まりどおり色と番号を一緒に出す
 * （docs/design/README.md の choice-1〜choice-4）。Tailwind は文字のままの class しか読まないので、組を書き下す
 */
const PANELS = [
  { number: 1, className: 'bg-choice-1 text-choice-1-foreground' },
  { number: 2, className: 'bg-choice-2 text-choice-2-foreground' },
  { number: 3, className: 'bg-choice-3 text-choice-3-foreground' },
  { number: 4, className: 'bg-choice-4 text-choice-4-foreground' },
] as const;

/** できること。順番のない並びなので、番号は付けない */
const FEATURES = [
  {
    heading: 'スマホで参加',
    description: '回答者は、ホストが映した QR コードを読んで名前を入れるだけ。アカウントは要りません。',
  },
  {
    heading: '速さも点になる',
    description: '正解が早いほど点が高くなります。問題ごとに、いちばん早く正解した3人を発表します。',
  },
  {
    heading: '問題セットを使い回せる',
    description: '一度作った問題セットから、何度でも部屋を開けます。部屋はプロジェクターに映して進めます。',
  },
] as const;

/**
 * 入口のページ（#294）。何ができるかを伝え、ホストのログインと使い方へつなぐ。
 * 回答者は QR か URL から部屋に直接入るので、部屋の ID を入れる欄は置かない
 */
export function LandingPage({ signedIn }: LandingPageProps) {
  const signIn = useGithubSignIn();

  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="font-logo text-display">ズバクイ</h1>
      <div aria-hidden="true" className="mt-cluster flex gap-item">
        {PANELS.map((panel) => (
          <span
            key={panel.number}
            className={cn(
              'flex size-12 items-center justify-center rounded-chip text-heading font-bold shadow-panel',
              panel.className,
            )}
          >
            {panel.number}
          </span>
        ))}
      </div>

      <p className="mt-section text-title font-bold text-phrase">早く正解するほど、点が高くなるクイズ</p>
      <p className="mt-item max-w-[60ch] text-body text-muted-foreground">
        ホストが問題をプロジェクターに映して進め、回答者は自分のスマホで選択肢を押して答えます。
      </p>

      <div className="mt-cluster flex flex-wrap gap-item">
        {signedIn ? (
          <Link to="/admin" className={buttonVariants({ size: 'lg' })}>
            問題セットへ
          </Link>
        ) : (
          <GithubSignInButton signIn={signIn}>GitHub でログイン</GithubSignInButton>
        )}
        <Link to="/guide" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          使い方を見る
        </Link>
      </div>
      {signIn.startError !== null && (
        <ActionError
          error={signIn.startError}
          failed="ログインを始められませんでした。もう一度押してください。"
          className="mt-item"
        />
      )}
      <div className="mt-cluster grid grid-cols-1 gap-related text-note text-muted-foreground">
        <p>
          {signedIn ? 'ホストとしてログインしています。' : 'ホストは、登録された GitHub アカウントでログインします。'}
        </p>
        <p>クイズに答えるだけなら、ログインは要りません。ホストから届いた QR コードか URL を開いてください。</p>
      </div>

      <section aria-labelledby="features-heading" className="mt-section">
        <h2 id="features-heading" className="text-title font-bold">
          できること
        </h2>
        <ul className="mt-cluster grid max-w-[60ch] grid-cols-1 gap-cluster">
          {FEATURES.map((feature) => (
            <li key={feature.heading} className="border-t-2 border-border pt-item">
              <h3 className="text-heading font-bold text-phrase">{feature.heading}</h3>
              <p className="mt-related text-body">{feature.description}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
