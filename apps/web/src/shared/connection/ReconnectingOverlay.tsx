import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

import type { Variant } from '@/shared/results/variant';

// oxfmt は cva の引数の class を並べ替える（.oxfmtrc.json の sortTailwindcss.functions）。定数の表に入れると並べ替えないので、cva で書く

/** 帯を置く場所。投影は画面の端の余白に合わせ、回答者画面は中身と同じ max-w-md の列に収める */
const placementVariants = cva('absolute inset-x-0 top-0', {
  variants: {
    variant: {
      projector: 'p-stage',
      mobile: 'mx-auto max-w-md px-3 pt-3',
    },
  },
});

const bandVariants = cva(
  'flex items-center gap-3 rounded-panel bg-alert font-bold text-alert-foreground shadow-panel',
  {
    variants: {
      variant: {
        projector: 'px-5 py-4 text-stage-label',
        mobile: 'px-4 py-3',
      },
    },
  },
);

/** 投影では文字が画面の幅で伸びるので、回る印も文字に合わせて em で伸ばす */
const spinnerVariants = cva(
  'shrink-0 rounded-full border-3 border-alert-foreground border-t-transparent motion-safe:animate-spin',
  {
    variants: {
      variant: {
        projector: 'size-[1.2em]',
        mobile: 'size-5',
      },
    },
  },
);

interface ReconnectingOverlayProps {
  variant: Variant;
  /** 帯の文。回答者とホストで違うので、呼ぶ側の接続のお知らせが渡す */
  message: string;
  /** つながっているときの画面。薄くして押せなくする */
  children: ReactNode;
}

/**
 * つなぎ直しているあいだ、中身を薄くして押せなくし、上に回る印と文の帯を重ねる（A1）。
 * ConnectionNotice（回答者）と HostConnectionNotice（ホスト）が使う。閉じたときの扱いは、相手ごとに違うのでそれぞれに残す。
 * 読み上げは持たない。箱と中身が同時に現れると role="status" は読まれないので、呼ぶ側の useConnectionAnnouncement が同じ文を渡す
 */
export function ReconnectingOverlay({ variant, message, children }: ReconnectingOverlayProps) {
  return (
    <div className="relative">
      {/* inert は押せなくするだけでなく、フォーカスも入らなくし、読み上げの木からも外す */}
      <div className="opacity-40" inert>
        {children}
      </div>
      <div className={placementVariants({ variant })}>
        <div className={bandVariants({ variant })}>
          <span className={spinnerVariants({ variant })} aria-hidden="true" />
          <p>{message}</p>
        </div>
      </div>
    </div>
  );
}
