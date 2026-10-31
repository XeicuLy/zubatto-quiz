import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { Button, buttonVariants } from './button';

describe('Button', () => {
  it('名前の付いたボタンとして出て、押すと onClick を呼ぶ', () => {
    const onClick = vi.fn<() => void>();
    render(<Button onClick={onClick}>部屋を作る</Button>);

    fireEvent.click(screen.getByRole('button', { name: '部屋を作る' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('既定では type="button" で、フォームの中に置いても送らない。submit を渡せば送る', () => {
    const onSubmit = vi.fn<() => void>();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Button>やめる</Button>
        <Button type="submit">参加する</Button>
      </form>,
    );

    expect(screen.getByRole('button', { name: 'やめる' })).toHaveAttribute('type', 'button');
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '参加する' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('無効のときは押せず、onClick を呼ばない', () => {
    const onClick = vi.fn<() => void>();
    render(
      <Button disabled onClick={onClick}>
        本当に消す
      </Button>,
    );

    const button = screen.getByRole('button', { name: '本当に消す' });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  // 色は役割の名前だけで選ぶ。.stage の中では同じ名前の値が入れ替わるので、暗い面でも同じ部品を使える
  it.each([
    ['default', ['bg-primary', 'text-primary-foreground']],
    ['outline', ['border-foreground']],
    ['destructive', ['bg-destructive', 'text-destructive-foreground']],
    ['link', ['text-muted-foreground', 'underline']],
  ] as const)('variant が %s のときは、役割の色 %j で出る', (variant, classes) => {
    render(<Button variant={variant}>押す</Button>);

    expect(screen.getByRole('button', { name: '押す' })).toHaveClass(...classes);
  });

  it('早押しパネルの厚み（押すと沈む）は、主の大きいボタンだけが持つ', () => {
    expect(buttonVariants({ variant: 'default', size: 'lg' })).toContain('shadow-panel');
    expect(buttonVariants({ variant: 'default', size: 'default' })).not.toContain('shadow-panel');
    expect(buttonVariants({ variant: 'outline', size: 'lg' })).not.toContain('shadow-panel');
  });

  it('className は足され、同じ性質の class はあとから渡したほうが勝つ', () => {
    render(
      <Button variant="link" className="mt-8 text-destructive">
        消す
      </Button>,
    );

    const button = screen.getByRole('button', { name: '消す' });
    expect(button).toHaveClass('mt-8', 'text-destructive');
    expect(button).not.toHaveClass('text-muted-foreground');
  });

  // Base UI の className は状態を受け取る関数も許すが、cva を通すと関数は捨てられる。関数は Base UI だけの API なので、
  // 画面から渡せないようにする（ADR 0007 の DD4: 画面を土台の API につなげない）。tsc がこの型を確かめる
  it('className は文字列だけを受け取る', () => {
    expectTypeOf<ComponentProps<typeof Button>['className']>().toEqualTypeOf<string | undefined>();
  });

  // フォーカスリングは styles.css の :focus-visible が全体に出す（#125）。部品が上書きすると、面ごとの二重の枠が崩れる
  it.each(['default', 'outline', 'destructive', 'link'] as const)(
    'variant が %s でも、フォーカスの見た目を自分で決めない',
    (variant) => {
      for (const size of ['sm', 'default', 'lg'] as const) {
        expect(buttonVariants({ variant, size })).not.toMatch(/focus-visible:|outline-none|ring-/);
      }
    },
  );
});
