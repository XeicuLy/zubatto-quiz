import { cva } from 'class-variance-authority';

import type { Variant } from '@/shared/results/variant';

// oxfmt は cva の引数の class を並べ替える（.oxfmtrc.json の sortTailwindcss.functions）。定数の表に入れると並べ替えないので、cva で書く

/** 投影は離れた席から見えるよう太くする。外の余白は置き場所で変わるので、呼ぶ側で付ける */
const trackVariants = cva('overflow-hidden rounded-full bg-muted', {
  variants: {
    variant: {
      projector: 'h-3',
      mobile: 'h-2',
    },
  },
});

interface TimeBarProps {
  /** 残りの割合（0〜1）。締切を過ぎた負の値は0にする */
  ratio: number;
  /** ratio の幅まで縮むのにかける時間 */
  transitionMs: number;
  variant: Variant;
}

/**
 * 残り時間の棒。進行画面（投影）と回答者画面で使う。
 * 値は useCountdown から呼ぶ側が作って渡す。部品は数えないので、タイマーなしで描ける。
 * 残りは数字でも出しているので、棒は読み上げない
 */
export function TimeBar({ ratio, transitionMs, variant }: TimeBarProps) {
  return (
    <div className={trackVariants({ variant })} aria-hidden="true">
      {/* 幅は描くたびに変わるので、クラスではなく style で渡す。React は CSSOM で書くので、CSP の style-src に触れない */}
      <div
        className="h-full rounded-full bg-primary transition-[width] ease-linear"
        style={{ width: `${Math.max(0, ratio) * 100}%`, transitionDuration: `${transitionMs}ms` }}
      />
    </div>
  );
}
