import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConnectionNotice } from './ConnectionNotice';

const content = <p>待機画面</p>;

describe('接続の知らせ（A1・ADR 0004）', () => {
  it.each(['connecting', 'open'] as const)('%s のときは中身だけを出す', (connection) => {
    render(
      <ConnectionNotice connection={connection} closeReason={null}>
        {content}
      </ConnectionNotice>,
    );

    expect(screen.getByText('待機画面')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('つなぎ直しているあいだは「再接続中」を出し、中身は押せなくする', () => {
    render(
      <ConnectionNotice connection="reconnecting" closeReason={null}>
        <button type="button">押す</button>
      </ConnectionNotice>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('接続が切れました。つなぎ直しています');
    expect(screen.getByRole('button', { name: '押す', hidden: true }).closest('[inert]')).not.toBeNull();
  });

  it.each([
    ['replaced', '別のタブで開かれました'],
    ['room_ended', 'この部屋は終わりました'],
    [null, '接続が閉じました'],
  ] as const)('%s で閉じたら「%s」を出し、中身は出さない', (closeReason, heading) => {
    render(
      <ConnectionNotice connection="closed" closeReason={closeReason}>
        {content}
      </ConnectionNotice>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(heading);
    expect(screen.queryByText('待機画面')).toBeNull();
  });
});
