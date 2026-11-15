import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderInRouter } from '../../../test/render-in-router';
import { LandingPage } from './LandingPage';

describe('入口のページ', () => {
  it('アプリの名前と、何ができるかを出す', async () => {
    await renderInRouter(<LandingPage signedIn={false} />);

    expect(screen.getByRole('heading', { level: 1, name: 'ズバクイ' })).toBeInTheDocument();
    expect(screen.getByText(/早く正解するほど/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'できること' })).toBeInTheDocument();
  });

  it('ログインしていなければ、ホストとしてログインするボタンと、使い方へのリンクを出す', async () => {
    await renderInRouter(<LandingPage signedIn={false} />);

    expect(screen.getByRole('button', { name: 'ホストとしてログイン' })).toBeEnabled();
    expect(screen.getByRole('link', { name: '使い方を見る' })).toHaveAttribute('href', '/guide');
    expect(screen.queryByRole('link', { name: '問題セットへ' })).not.toBeInTheDocument();
  });

  it('ログインしていれば、ログインのボタンの代わりに、問題セットの一覧へのリンクを出す', async () => {
    await renderInRouter(<LandingPage signedIn />);

    expect(screen.getByRole('link', { name: '問題セットへ' })).toHaveAttribute('href', '/admin');
    expect(screen.queryByRole('button', { name: 'ホストとしてログイン' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '使い方を見る' })).toHaveAttribute('href', '/guide');
  });

  it('回答者には、ログインが要らないことと、ホストの URL を開けばよいことを伝える', async () => {
    await renderInRouter(<LandingPage signedIn={false} />);

    expect(screen.getByText(/クイズに答えるだけなら、ログインは要りません/)).toBeInTheDocument();
    // 回答者は QR か URL から部屋に直接入るので、部屋の ID を入れる欄は置かない
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('ログインを始められなければ、ボタンのそばに、やり直し方を添えて知らせる', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 500 }));
    await renderInRouter(<LandingPage signedIn={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'ホストとしてログイン' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ログインを始められませんでした。もう一度押してください。',
    );
    expect(screen.getByRole('button', { name: 'ホストとしてログイン' })).toBeEnabled();
  });
});
