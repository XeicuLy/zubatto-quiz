import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Variant } from '@/shared/results/variant';

import { MessageScreen } from './MessageScreen';

const variants: Variant[] = ['projector', 'mobile'];

describe.each(variants)('知らせの画面（%s）', (variant) => {
  it('見出しと本文を出す', () => {
    render(
      <MessageScreen
        variant={variant}
        title="部屋が見つかりません"
        body="URL が正しいか、ホストに確かめてください。"
      />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('部屋が見つかりません');
    expect(screen.getByText('URL が正しいか、ホストに確かめてください。')).toBeInTheDocument();
  });

  it('本文のあとに、渡した操作を置く', () => {
    render(
      <MessageScreen variant={variant} title="部屋が見つかりません" body="一覧から開き直してください。">
        <a href="/admin">一覧へ戻る</a>
      </MessageScreen>,
    );

    expect(screen.getByRole('main').lastElementChild).toBe(screen.getByRole('link', { name: '一覧へ戻る' }));
  });

  it('読み上げは呼ぶ側の接続のお知らせに任せ、role="status" を付けない', () => {
    render(<MessageScreen variant={variant} title="接続が閉じました" body="ページを読み込み直してください。" />);

    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('大きさ', () => {
  it('projector は画面の幅で伸びる文字にする', () => {
    render(<MessageScreen variant="projector" title="部屋が見つかりません" body="一覧から開き直してください。" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('text-stage-title');
    expect(screen.getByText('一覧から開き直してください。')).toHaveClass('text-stage-label');
  });

  it('mobile は md: のクラスを使わず、max-w-md の列に収める', () => {
    const { container } = render(
      <MessageScreen variant="mobile" title="この部屋は満員です" body="ホストに、別の部屋を作れるか聞いてください。" />,
    );

    expect(container.querySelector('[class*="md:"]')).toBeNull();
    expect(screen.getByRole('main')).toHaveClass('max-w-md');
  });
});
