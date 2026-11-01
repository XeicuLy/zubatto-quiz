import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Card, cardVariants } from './card';

describe('Card', () => {
  it('中身を描き、role などの属性はそのまま渡る', () => {
    render(
      <Card role="alert">
        <p>問題セットを読めませんでした</p>
      </Card>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('問題セットを読めませんでした');
  });

  // 色は役割の名前だけで選ぶ。.stage の中では同じ名前の値が入れ替わるので、暗い面でも同じ部品を使える
  it.each([
    ['default', 'border-border'],
    ['destructive', 'border-destructive'],
  ] as const)('variant が %s のときは、枠を %s にし、面と文字は card の色で出る', (variant, border) => {
    render(<Card variant={variant}>中身</Card>);

    expect(screen.getByText('中身')).toHaveClass(
      'rounded-panel',
      'border-2',
      border,
      'bg-card',
      'text-card-foreground',
      'p-5',
    );
  });

  it('variant を渡さなければ default で出る', () => {
    expect(cardVariants()).toBe(cardVariants({ variant: 'default' }));
  });

  it('className は足され、同じ性質の class はあとから渡したほうが勝つ', () => {
    render(<Card className="mt-8 p-10">中身</Card>);

    const card = screen.getByText('中身');
    expect(card).toHaveClass('mt-8', 'p-10');
    expect(card).not.toHaveClass('p-5');
  });
});
