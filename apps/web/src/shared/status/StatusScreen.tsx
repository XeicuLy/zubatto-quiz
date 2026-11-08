import { cva } from 'class-variance-authority';

import { useAnnouncement } from '@/components/a11y/announce';
import type { Variant } from '@/shared/results/variant';

// oxfmt は cva の引数の class を並べ替える（.oxfmtrc.json の sortTailwindcss.functions）。定数の表に入れると並べ替えないので、cva で書く

/**
 * 投影では、外の flex の列（HostPage の min-h-dvh の箱）の残りを埋める。下に操作の帯が並ぶので、min-h-dvh にはしない。
 * 回答者画面は1枚の画面なので、自分で min-h-dvh にする。右下の効果音の切り替えに重ならないよう pb-24 を空ける
 */
const mainVariants = cva('flex flex-col justify-center', {
  variants: {
    variant: {
      projector: 'flex-1 p-stage',
      mobile: 'mx-auto min-h-dvh max-w-md px-5 pb-24',
    },
  },
});

const textVariants = cva('font-bold', {
  variants: {
    variant: {
      projector: 'text-stage-title',
      mobile: 'text-heading',
    },
  },
});

/**
 * 部屋の様子や結果が届くまでのつなぎの画面。進行画面（投影）と回答者画面で使う。
 * 画面ごと現れるので role="status" は付けず、読み上げ領域に文を渡す
 */
export function StatusScreen({ variant, children }: { variant: Variant; children: string }) {
  useAnnouncement(children);
  return (
    <main className={mainVariants({ variant })}>
      <p className={textVariants({ variant })}>{children}</p>
    </main>
  );
}
