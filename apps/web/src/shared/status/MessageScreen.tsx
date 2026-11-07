import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

import type { Variant } from '@/shared/results/variant';

// oxfmt は cva の引数の class を並べ替える（.oxfmtrc.json の sortTailwindcss.functions）。定数の表に入れると並べ替えないので、cva で書く

const mainVariants = cva('flex min-h-dvh flex-col justify-center gap-4', {
  variants: {
    variant: {
      projector: 'p-stage',
      // 右下の効果音の切り替えに重ならないよう pb-24 を空ける
      mobile: 'mx-auto max-w-md px-5 pb-24',
    },
  },
});

const titleVariants = cva('font-bold', {
  variants: {
    variant: {
      projector: 'text-stage-title',
      mobile: 'text-3xl leading-snug',
    },
  },
});

const bodyVariants = cva('leading-relaxed text-muted-foreground', {
  variants: {
    variant: {
      projector: 'text-stage-label',
      mobile: '',
    },
  },
});

interface MessageScreenProps {
  variant: Variant;
  title: string;
  body: string;
  /** 本文のあとに置く操作（ホストの「一覧へ戻る」など） */
  children?: ReactNode;
}

/**
 * 部屋に入れない・接続が閉じたときに、中身の代わりに出す画面。見出しと本文で理由を伝える。
 * 読み上げは持たない。閉じた画面は接続のお知らせ（useConnectionAnnouncement）が文を渡すので、ここでも言うと2回読まれる
 */
export function MessageScreen({ variant, title, body, children }: MessageScreenProps) {
  return (
    <main className={mainVariants({ variant })}>
      <h1 className={titleVariants({ variant })}>{title}</h1>
      <p className={bodyVariants({ variant })}>{body}</p>
      {children}
    </main>
  );
}
