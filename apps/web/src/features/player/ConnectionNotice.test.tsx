import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConnectionNotice } from './ConnectionNotice';

const content = <p>待機画面</p>;

describe('接続の知らせ（A1・ADR 0004）', () => {
  it.each(['connecting', 'open'] as const)('%s のときは中身だけを出す', (connection) => {
    render(
      <ConnectionNotice connection={connection} closeReason={null} roomEnd={null}>
        {content}
      </ConnectionNotice>,
    );

    expect(screen.getByText('待機画面')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('つなぎ直しているあいだは「再接続中」を出し、中身は押せなくする', () => {
    render(
      <ConnectionNotice connection="reconnecting" closeReason={null} roomEnd={null}>
        <button type="button">押す</button>
      </ConnectionNotice>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('接続が切れました。つなぎ直しています');
    expect(screen.getByRole('button', { name: '押す', hidden: true }).closest('[inert]')).not.toBeNull();
  });

  it.each([
    ['replaced', '別のタブで開かれました'],
    [null, '接続が閉じました'],
  ] as const)('%s で閉じたら「%s」を出し、中身は出さない', (closeReason, heading) => {
    render(
      <ConnectionNotice connection="closed" closeReason={closeReason} roomEnd={null}>
        {content}
      </ConnectionNotice>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(heading);
    expect(screen.queryByText('待機画面')).toBeNull();
  });
});

describe('部屋が終わったときの知らせ（#97・F17）', () => {
  it('最終ランキングのあとに終わったら、中身を残したまま、上に終わったことを出す', () => {
    render(
      <ConnectionNotice connection="closed" closeReason="room_ended" roomEnd="after_final">
        <button type="button">最終ランキング</button>
      </ConnectionNotice>,
    );

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('この部屋は終わりました');
    expect(notice).toHaveTextContent('最終の結果は、この画面で見られます。');
    // 薄くも押せなくもしない。手元の最終ランキングは、そのまま読める
    expect(screen.getByRole('button', { name: '最終ランキング' }).closest('[inert]')).toBeNull();
  });

  it.each([
    ['midway', 'ホストが部屋を途中で終えました。遊んでくれてありがとうございました。'],
    // 終わったあとに読み込み直した人も、あとから URL を開いた人もここに来る。途中かどうかは分からない
    ['not_entered', '遊んでくれてありがとうございました。'],
  ] as const)('%s なら、中身の代わりに「%s」を出す', (roomEnd, body) => {
    render(
      <ConnectionNotice connection="closed" closeReason="room_ended" roomEnd={roomEnd}>
        {content}
      </ConnectionNotice>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('この部屋は終わりました');
    // getByText は文の全体と比べるので、ほかの文が混ざっていれば見つからない
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.queryByText('待機画面')).toBeNull();
  });

  it.each(['after_final', 'midway', 'not_entered'] as const)(
    '%s でも、スクリーンがある前提の文言を出さない',
    (roomEnd) => {
      const { container } = render(
        <ConnectionNotice connection="closed" closeReason="room_ended" roomEnd={roomEnd}>
          {content}
        </ConnectionNotice>,
      );

      expect(container).not.toHaveTextContent('スクリーン');
    },
  );
});
