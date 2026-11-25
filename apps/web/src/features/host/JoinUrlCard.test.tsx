import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JoinUrlCard } from './JoinUrlCard';

const JOIN_URL = `https://zubakui.example/r/${'a'.repeat(64)}`;

/** jsdom は navigator.clipboard を持たないので、テストごとに置く。undefined を渡すと、http のページのように無い状態になる */
function stubClipboard(clipboard: Pick<Clipboard, 'writeText'> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

afterEach(() => {
  stubClipboard(undefined);
});

describe('参加用の URL（F1）', () => {
  it('URL を文字で全部出す', () => {
    render(<JoinUrlCard joinUrl={JOIN_URL} />);

    expect(screen.getByText(JOIN_URL)).toBeInTheDocument();
  });

  it('カメラで読み取れる QR コードを出し、URL はその下に出す', () => {
    render(<JoinUrlCard joinUrl={JOIN_URL} />);

    expect(screen.getByRole('img', { name: '参加用 URL の QR コード' })).toBeInTheDocument();
    expect(screen.getByText('カメラで読み取るか、下の URL を開いて、名前を入れてください')).toBeInTheDocument();
  });

  // 64桁の ID を含む URL を手で打つ人はいない。遠くから読めるべきなのは QR なので、URL は QR より目立たせない（#335）
  it('URL は見出しより小さい投影のラベルの大きさで、補足の色にする', () => {
    render(<JoinUrlCard joinUrl={JOIN_URL} />);

    expect(screen.getByText(JOIN_URL)).toHaveClass('text-stage-label', 'text-muted-foreground');
  });

  it('「URL をコピー」で、参加用の URL をクリップボードに書き込む', async () => {
    const writeText = vi.fn<Clipboard['writeText']>(async () => {});
    stubClipboard({ writeText });
    render(<JoinUrlCard joinUrl={JOIN_URL} />);

    fireEvent.click(screen.getByRole('button', { name: 'URL をコピー' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('コピーしました'));
    expect(writeText).toHaveBeenCalledWith(JOIN_URL);
  });

  it.each([
    ['書き込みを断られた', { writeText: async () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }],
    // http のページ（localhost 以外）では navigator.clipboard そのものが無い
    ['クリップボードが使えない', undefined],
  ])('%sときは、手でコピーしてもらう', async (_, clipboard) => {
    stubClipboard(clipboard);
    render(<JoinUrlCard joinUrl={JOIN_URL} />);

    fireEvent.click(screen.getByRole('button', { name: 'URL をコピー' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('コピーできませんでした。URL を選んでコピーしてください'),
    );
  });
});
