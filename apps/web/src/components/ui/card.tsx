import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/tailwind';

/**
 * ひとまとまりの知らせや内容を囲む面（shadcn/ui の Card、CLI 4.22.1 の base-nova をもとにした。ADR 0007）。
 * 色は役割の名前だけで選ぶ。暗い面（.stage）の中では同じ名前の値が入れ替わるので、面を variant にしない。
 * ひな形から、次のものを外した。
 * - CardHeader・CardTitle などの小部品: 中身の見出しは画面ごとに要素（p・h1）も大きさも違うので、画面が書く
 * - ring-1 ring-foreground/10 の枠: 枠は border-2 にし、色を variant で選ぶ
 * - rounded-xl・py-(--card-spacing)・text-sm: 角は rounded-panel、余白は p-5 にし、文字の大きさは中身に任せる
 * - overflow-hidden と img の class: 画像を入れない
 * role（誤りの知らせなら role="alert"）は、画面が渡す
 */
const cardVariants = cva('rounded-panel border-2 bg-card p-5 text-card-foreground', {
  variants: {
    variant: {
      /** ふつうの内容 */
      default: 'border-border',
      /** 誤りの知らせ（読めなかった、ログインが切れた、拒否された） */
      destructive: 'border-destructive',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

type CardProps = ComponentProps<'div'> & VariantProps<typeof cardVariants>;

function Card({ className, variant = 'default', ...props }: CardProps) {
  return <div data-slot="card" className={cn(cardVariants({ variant, className }))} {...props} />;
}

export { Card, cardVariants };
