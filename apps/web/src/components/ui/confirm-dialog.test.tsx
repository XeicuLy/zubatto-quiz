import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import { ConfirmDialog, useConfirm } from './confirm-dialog';

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn<() => void>();
  const onCancel = vi.fn<() => void>();
  render(
    <ConfirmDialog
      title="部屋を終えます"
      detail="全員の接続が切れ、この部屋には戻れません。"
      confirmLabel="部屋を終える"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
}

describe('ConfirmDialog', () => {
  it('題で名付け、説明を添えた alertdialog として出る', () => {
    renderDialog();

    const dialog = screen.getByRole('alertdialog', { name: '部屋を終えます' });
    expect(dialog).toHaveAccessibleDescription('全員の接続が切れ、この部屋には戻れません。');
  });

  it('開いたら「やめる」にフォーカスする。押し間違えても進まない方に合わせる', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'やめる' })).toHaveFocus();
  });

  it('やめる側の名前は cancelLabel で変えられ、そちらにフォーカスする', () => {
    renderDialog({ cancelLabel: '編集に戻る' });

    expect(screen.getByRole('button', { name: '編集に戻る' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'やめる' })).not.toBeInTheDocument();
  });

  it('確定のボタンで onConfirm、やめるボタンで onCancel を呼ぶ', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: '部屋を終える' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('中のどこから上がってきた Esc でも onCancel を呼ぶ', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.keyDown(screen.getByRole('button', { name: '部屋を終える' }), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('確定はいつも destructive で、size は両方のボタンに渡る', () => {
    renderDialog({ size: 'sm' });

    expect(screen.getByRole('button', { name: '部屋を終える' })).toHaveClass('bg-destructive', 'h-9');
    expect(screen.getByRole('button', { name: 'やめる' })).toHaveClass('border-2', 'h-9');
  });

  describe('送っているあいだ（pending）', () => {
    it('どちらも押せず、Esc も受けない', () => {
      const { onConfirm, onCancel } = renderDialog({ pending: true });

      fireEvent.click(screen.getByRole('button', { name: '部屋を終える' }));
      fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
      fireEvent.keyDown(screen.getByRole('button', { name: 'やめる' }), { key: 'Escape' });

      expect(onConfirm).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });

    // disabled 属性だとフォーカスが body へ落ち、失敗したときに居場所がなくなる
    it('押した確定のボタンにフォーカスを残したまま、押せないことを aria-disabled で伝える', () => {
      const { rerender } = render(<PendingHarness pending={false} />);
      const confirm = screen.getByRole('button', { name: '本当に消す' });
      confirm.focus();

      rerender(<PendingHarness pending />);

      expect(confirm).toHaveFocus();
      expect(confirm).toHaveAttribute('aria-disabled', 'true');
      expect(confirm).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'やめる' })).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('閉じたときのフォーカス', () => {
    it('開く前にフォーカスのあった要素が残っていれば、そこへ戻す', () => {
      render(<OpenerStays />);
      const opener = screen.getByRole('button', { name: '一覧に戻る' });
      opener.focus();

      fireEvent.click(opener);
      expect(screen.getByRole('button', { name: 'やめる' })).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'やめる' }));

      expect(opener).toHaveFocus();
    });
  });
});

describe('useConfirm', () => {
  it('開いたボタンが確かめるあいだ外されても、閉じたら描き直したそのボタンへ戻す', () => {
    render(<OpenerReplaced />);

    fireEvent.click(screen.getByRole('button', { name: '終える' }));
    expect(screen.queryByRole('button', { name: '終える' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));

    expect(screen.getByRole('button', { name: '終える' })).toHaveFocus();
  });

  it('いくつかの開くボタンのうち、開いたほうへ戻す', () => {
    render(<OpenerReplaced />);

    fireEvent.click(screen.getByRole('button', { name: 'やり直す' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'やめる' }), { key: 'Escape' });

    expect(screen.getByRole('button', { name: 'やり直す' })).toHaveFocus();
  });

  it('作り直した直後は、何も開いていないのでフォーカスを動かさない', () => {
    render(<OpenerReplaced />);

    expect(document.body).toHaveFocus();
  });
});

function PendingHarness({ pending }: { pending: boolean }) {
  return (
    <ConfirmDialog
      title="本当に消しますか？"
      detail="消した問題セットは戻せません。"
      confirmLabel="本当に消す"
      onConfirm={() => {}}
      onCancel={() => {}}
      pending={pending}
    />
  );
}

/** 編集画面のように、確かめるあいだも開いた要素が残る */
function OpenerStays() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>一覧に戻る</Button>
      {open && (
        <ConfirmDialog
          title="保存していない変更があります"
          detail="このまま離れると、書いた内容は消えます。"
          confirmLabel="保存せずに離れる"
          onConfirm={() => {}}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** ホストの帯のように、確かめる表示が開いたボタンと置き換わる */
function OpenerReplaced() {
  const confirm = useConfirm<'retry' | 'end'>();
  const retryButton = useRef<HTMLButtonElement>(null);
  const endButton = useRef<HTMLButtonElement>(null);

  if (confirm.confirming !== null) {
    return (
      <ConfirmDialog
        title="確かめる"
        detail="説明"
        confirmLabel="進む"
        onConfirm={confirm.close}
        onCancel={confirm.close}
      />
    );
  }
  return (
    <>
      <Button ref={retryButton} onClick={() => confirm.open('retry', retryButton)}>
        やり直す
      </Button>
      <Button ref={endButton} onClick={() => confirm.open('end', endButton)}>
        終える
      </Button>
    </>
  );
}
