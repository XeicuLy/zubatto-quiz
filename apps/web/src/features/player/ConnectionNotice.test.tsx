import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { liveRegion } from '../../../test/live-region';
import { Announcer } from '../../components/a11y/Announcer';
import { ConnectionNotice } from './ConnectionNotice';

const content = <p>待機画面</p>;

/** __root と同じく、読み上げ領域を並べて描く */
function withAnnouncer(notice: ReactNode) {
  return (
    <>
      {notice}
      <Announcer />
    </>
  );
}

describe('接続の知らせ（A1・ADR 0004）', () => {
  it.each(['connecting', 'open'] as const)('%s のときは中身だけを出す', (connection) => {
    render(
      <ConnectionNotice connection={connection} closeReason={null} roomEnd={null}>
        {content}
      </ConnectionNotice>,
    );

    expect(screen.getByText('待機画面')).toBeInTheDocument();
    expect(screen.queryByText(/接続/)).toBeNull();
  });

  it('つなぎ直しているあいだは「再接続中」を出して読み上げ、中身は押せなくする', async () => {
    render(
      withAnnouncer(
        <ConnectionNotice connection="reconnecting" closeReason={null} roomEnd={null}>
          <button type="button">押す</button>
        </ConnectionNotice>,
      ),
    );

    expect(screen.getByText('接続が切れました。つなぎ直しています', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '押す', hidden: true }).closest('[inert]')).not.toBeNull();
    await waitFor(() => expect(liveRegion('polite')).toHaveTextContent('接続が切れました。つなぎ直しています'));
    // 見える帯は箱と中身が同時に現れるので、読み上げは常にある領域に任せる
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('つなぎ直せたら「つながりました」と読み上げる', async () => {
    const { rerender } = render(
      withAnnouncer(
        <ConnectionNotice connection="reconnecting" closeReason={null} roomEnd={null}>
          {content}
        </ConnectionNotice>,
      ),
    );
    await waitFor(() => expect(liveRegion('polite')).toHaveTextContent('つなぎ直しています'));

    rerender(
      withAnnouncer(
        <ConnectionNotice connection="open" closeReason={null} roomEnd={null}>
          {content}
        </ConnectionNotice>,
      ),
    );

    await waitFor(() => expect(liveRegion('polite')).toHaveTextContent(/^つながりました$/));
  });

  it.each(['connecting', 'open'] as const)('切れる前の %s では、何も読み上げない', async (connection) => {
    render(
      withAnnouncer(
        <ConnectionNotice connection={connection} closeReason={null} roomEnd={null}>
          {content}
        </ConnectionNotice>,
      ),
    );

    // 待ってから空であることを確かめる。待たずに見ると、入る前の空を見てしまう
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(liveRegion('polite')).toBeEmptyDOMElement();
    expect(liveRegion('assertive')).toBeEmptyDOMElement();
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

  it('別のタブで開かれたら、見出しと本文を急ぎで読み上げる', async () => {
    render(
      withAnnouncer(
        <ConnectionNotice connection="closed" closeReason="replaced" roomEnd={null}>
          {content}
        </ConnectionNotice>,
      ),
    );

    await waitFor(() =>
      expect(liveRegion('assertive')).toHaveTextContent(
        /^別のタブで開かれました。この部屋を別のタブで開いたため、.*引き継がれています。$/,
      ),
    );
  });
});

describe('部屋が終わったときの知らせ（#97・F17）', () => {
  it('最終ランキングのあとに終わったら、中身を残したまま、上に終わったことを出して急ぎで読み上げる', async () => {
    render(
      withAnnouncer(
        <ConnectionNotice connection="closed" closeReason="room_ended" roomEnd="after_final">
          <button type="button">最終ランキング</button>
        </ConnectionNotice>,
      ),
    );

    expect(screen.getByText('この部屋は終わりました', { selector: 'p' })).toBeInTheDocument();
    expect(
      screen.getByText('最終の結果は、この画面で見られます。', { exact: false, selector: 'p' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(liveRegion('assertive')).toHaveTextContent(
        'この部屋は終わりました。遊んでくれてありがとうございました。最終の結果は、この画面で見られます。',
      ),
    );
    // 薄くも押せなくもしない。手元の最終ランキングは、そのまま読める
    expect(screen.getByRole('button', { name: '最終ランキング' }).closest('[inert]')).toBeNull();
  });

  it.each([
    ['midway', 'ホストが部屋を途中で終えました。遊んでくれてありがとうございました。'],
    // 終わったあとに読み込み直した人も、あとから URL を開いた人もここに来る。途中かどうかは分からない
    ['not_entered', '遊んでくれてありがとうございました。'],
  ] as const)('%s なら、中身の代わりに「%s」を出し、急ぎで読み上げる', async (roomEnd, body) => {
    render(
      withAnnouncer(
        <ConnectionNotice connection="closed" closeReason="room_ended" roomEnd={roomEnd}>
          {content}
        </ConnectionNotice>,
      ),
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('この部屋は終わりました');
    // getByText は文の全体と比べるので、ほかの文が混ざっていれば見つからない。読み上げ領域は p ではないので外す
    expect(screen.getByText(body, { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText('待機画面')).toBeNull();
    await waitFor(() => expect(liveRegion('assertive')).toHaveTextContent(`この部屋は終わりました。${body}`));
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
