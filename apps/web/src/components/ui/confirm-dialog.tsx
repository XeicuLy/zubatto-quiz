import { type KeyboardEvent, type RefObject, useId, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/tailwind';

import { Button } from './button';

interface ConfirmDialogProps {
  /** 何が起きるか。alertdialog の名前になる */
  title: string;
  /** 戻せないことなど、押す前に知っておくこと。alertdialog の説明になる */
  detail: string;
  confirmLabel: string;
  /** 押し間違えても何も起きない側。開いたらここにフォーカスする */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 置く場所に合わせた Button の size。両方のボタンに渡す */
  size?: 'sm' | 'default' | 'lg';
  /** 確定を送っているあいだ。どちらも押せず、Esc も受けない */
  pending?: boolean;
  className?: string;
}

/**
 * 戻せない操作の前の確かめ（#111 で決め、#133 で部品にした。ADR 0007）。
 * shadcn/ui の AlertDialog はモーダルで画面を覆うので使わず、開いたボタンや帯の場所に出す。
 * ホストの確認のあいだも残り時間と受信が見えたまま動き、window.confirm のようにページを止めない。
 * - 開いたら cancel のボタンにフォーカスし、押し間違えても進まない方に合わせる。autoFocus は jsx-a11y の no-autofocus に当たるので、ref で動かす
 * - Esc で閉じる。その場に出すので、フォーカスが中にあるときだけ受ける
 * - 閉じたとき、開く前にフォーカスのあった要素が残っていれば、そこへ戻す（編集画面の「一覧に戻る」）。
 *   開いたボタンと置き換えて出すときは、そのボタンは外されているので、useConfirm が戻す
 * - 確定はいつも destructive にする。ここで確かめるのは、どれも戻せない操作のため
 */
function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  cancelLabel = 'やめる',
  onConfirm,
  onCancel,
  size = 'default',
  pending = false,
  className,
}: ConfirmDialogProps) {
  const titleId = useId();
  const detailId = useId();
  const cancelButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const previous = document.activeElement;
    cancelButton.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) {
        previous.focus();
      }
    };
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !pending) {
      onCancel();
    }
  }

  return (
    // 中のボタンから上がってくる Esc を受けるだけで、箱そのものは操作しない。役割は alertdialog のままにする
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={detailId}
      onKeyDown={onKeyDown}
      className={cn('flex flex-wrap items-center gap-x-cluster gap-y-item', className)}
    >
      <div className="min-w-0">
        <p id={titleId} className="font-bold">
          {title}
        </p>
        <p id={detailId} className="text-note text-muted-foreground">
          {detail}
        </p>
      </div>
      {/* スマホでは幅を分け合って親指で押しやすくし、広い画面では文字の幅に戻して右へ寄せる */}
      <div className="flex w-full flex-wrap gap-item lg:ml-auto lg:w-auto">
        {/* disabled 属性にすると、押した確定のボタンからフォーカスが body へ落ちる。aria-disabled にしてそこに残す */}
        <Button
          ref={cancelButton}
          variant="outline"
          size={size}
          onClick={onCancel}
          disabled={pending}
          focusableWhenDisabled
          className="flex-1 aria-disabled:opacity-50 lg:flex-none"
        >
          {cancelLabel}
        </Button>
        <Button
          variant="destructive"
          size={size}
          onClick={onConfirm}
          disabled={pending}
          focusableWhenDisabled
          className="flex-1 aria-disabled:opacity-50 lg:flex-none"
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * 開いたボタンと置き換えて ConfirmDialog を出すときの、開いている確かめと戻す先（#111）。
 * 置き換えると開いたボタンは外され、閉じたあとに新しい要素として描き直される。
 * そのため要素ではなく ref を覚え、閉じて描き直したあとに、その ref が指すボタンへフォーカスを戻す。
 * 作り直した直後は何も開いていないので、作っただけではフォーカスを動かさない（ホストの帯は段階ごとに key で作り直す）
 */
function useConfirm<T extends string>() {
  const [confirming, setConfirming] = useState<T | null>(null);
  const opener = useRef<RefObject<HTMLElement | null> | null>(null);

  useLayoutEffect(() => {
    if (confirming === null && opener.current !== null) {
      opener.current.current?.focus();
      opener.current = null;
    }
  }, [confirming]);

  function open(which: T, from: RefObject<HTMLElement | null>) {
    opener.current = from;
    setConfirming(which);
  }

  function close() {
    setConfirming(null);
  }

  return { confirming, open, close };
}

export { ConfirmDialog, useConfirm };
