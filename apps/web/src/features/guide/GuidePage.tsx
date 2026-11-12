import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { buttonVariants } from '@/components/ui/button';

import { GUIDE_VIEWPORTS, hostSteps, playerSteps, type GuideStep } from './guide-steps';

/**
 * 画像の URL（キーは './images/<名前>.png'）。ビルドでは同じオリジンのハッシュ付きの URL になる。
 * assetsInlineLimit: 0 なので data: にはならず、CSP の default-src 'self' を通る（ADR 0004）。
 * glob をソースにそのまま書き、型引数は付けずに as で型を付ける。vitest 5 の fsModuleCache は、glob の呼び出しの文字がある
 * ファイルだけをキャッシュから外す（test/story-files.ts）。new URL の形でも Vite は glob に変えるが、その文字がないので、
 * 画像を足しても前の一覧が残り、src が undefined になった（vitest 5.0.5、2026-11-12）
 */
const imageUrls = import.meta.glob('./images/*.png', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>;

function imageUrl(image: GuideStep['image']): string | undefined {
  return imageUrls[`./images/${image}.png`];
}

/**
 * 使い方のページ（#285）。ホストと回答者の流れを、画面の画像と一緒に順に見せる。
 * 中身はビルドの時に決まる値だけで、API を読まない。ログインせずに開ける
 */
export function GuidePage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <Link to="/" className="font-logo text-heading">
        ズバクイ
      </Link>
      <h1 className="mt-related text-display font-bold">使い方</h1>
      <p className="mt-item max-w-[60ch] text-body text-muted-foreground">
        ズバクイは、早く正解するほど点が高くなるクイズです。ホストが問題を映して進め、回答者は自分のスマホで答えます。
      </p>

      <nav aria-label="このページの中身" className="mt-cluster">
        <ul className="flex flex-wrap gap-x-cluster gap-y-related">
          <li>
            <a href="#host-flow" className="font-bold underline underline-offset-4">
              ホストの流れ
            </a>
          </li>
          <li>
            <a href="#player-flow" className="font-bold underline underline-offset-4">
              回答者の流れ
            </a>
          </li>
        </ul>
      </nav>

      <GuideSection id="host-flow" title="ホストの流れ" steps={hostSteps}>
        <p className="mt-related max-w-[60ch] text-body">
          問題セットを作り、部屋を開いて、プロジェクターに映しながら進めます。
        </p>
        <Link to="/login" className={buttonVariants({ size: 'lg', className: 'mt-cluster' })}>
          ホストとしてログインする
        </Link>
      </GuideSection>

      <GuideSection id="player-flow" title="回答者の流れ" steps={playerSteps}>
        <p className="mt-related max-w-[60ch] text-body">ホストから届いた QR コードか URL を開いて答えます。</p>
      </GuideSection>
    </main>
  );
}

interface GuideSectionProps {
  id: string;
  title: string;
  steps: readonly GuideStep[];
  /** 見出しと手順のあいだに置く、節の説明 */
  children: ReactNode;
}

function GuideSection({ id, title, steps, children }: GuideSectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className="mt-section border-t-2 border-border pt-cluster">
      <h2 id={headingId} className="text-title font-bold">
        {title}
      </h2>
      {children}
      <ol aria-labelledby={headingId} className="mt-section grid grid-cols-1 gap-section">
        {steps.map((step, index) => (
          <li key={step.image} className="grid grid-cols-1 gap-item">
            <div className="flex items-center gap-item">
              {/* 番号は <ol> が読み上げるので、丸は見た目だけにする */}
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-label font-bold text-primary-foreground"
              >
                {index + 1}
              </span>
              <h3 className="text-heading font-bold">{step.heading}</h3>
            </div>
            <p className="max-w-[60ch] text-body">{step.description}</p>
            <img
              src={imageUrl(step.image)}
              alt={step.alt}
              width={GUIDE_VIEWPORTS[step.device].width}
              height={GUIDE_VIEWPORTS[step.device].height}
              loading="lazy"
              decoding="async"
              className={
                step.device === 'phone'
                  ? 'h-auto w-full max-w-60 rounded-panel border-2 border-border'
                  : 'h-auto w-full rounded-panel border-2 border-border'
              }
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
