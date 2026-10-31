import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/tailwind';

/**
 * ボタンの見た目（shadcn/ui の Button、CLI 4.22.1 の base-nova をもとにした。ADR 0007）。
 * 色は役割の名前だけで選ぶ。暗い面（.stage）の中では同じ名前の値が入れ替わるので、面を variant にしない。
 * ひな形から、次のものを外した。
 * - フォーカスの class（outline-none・ring-3）: styles.css の :focus-visible が、面ごとの二重の枠を全体に出す（#125）
 * - transition-all: 動きは最速正解者と優勝の発表の1か所だけにする（docs/design/README.md）
 * - aria-invalid の class: 使っていない
 * アイコン（svg）は文字の 1.25 倍にし、文字との間は gap-related でとる。size-* を付けた svg は、その大きさのまま
 * <Link> をボタンの見た目にするときは、Button の render ではなく buttonVariants の class を渡す。
 * render で <a> を描かせると role="button" が付き、リンクとして読まれなくなる
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-related rounded-full font-bold whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-[1.25em]',
  {
    variants: {
      variant: {
        /** その画面でいちばん押してほしい操作 */
        default: 'bg-primary text-primary-foreground',
        /** 主の操作と並ぶ、別の操作。枠は文字と同じ色にし、どちらの面でも背景に 3:1 以上にする */
        outline: 'border-2 border-foreground',
        /** 消すなど、戻せない操作 */
        destructive: 'bg-destructive text-destructive-foreground',
        /** 目立たせない操作。危ない操作のときは className="text-destructive" で色を変える */
        link: 'text-muted-foreground underline underline-offset-4 disabled:no-underline',
      },
      size: {
        /** 一覧の行の中など、いくつも並ぶ場所 */
        sm: 'h-9 px-4 text-note',
        default: 'h-11 px-5 text-label',
        /** 画面に1つの大きな操作（ログイン、ホストの進行） */
        lg: 'h-14 px-6 text-label',
      },
    },
    compoundVariants: [
      {
        // 早押しパネルの厚み。押すと沈む。目立たせるのは、主の大きいボタンだけにする
        variant: 'default',
        size: 'lg',
        class: 'shadow-panel active:translate-y-1.5 active:shadow-none',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

/**
 * className は文字列だけを受け取る。Base UI は状態を受け取る関数も許すが、cva を通すと捨てられるうえ、
 * 画面が土台の API につながってしまう（ADR 0007 の DD4）
 */
type ButtonProps = Omit<ButtonPrimitive.Props, 'className'> &
  VariantProps<typeof buttonVariants> & {
    className?: string;
  };

/** type の既定は "button"（Base UI が付ける）。フォームを送るボタンだけ type="submit" を渡す */
function Button({ className, variant = 'default', size = 'default', ...props }: ButtonProps) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
