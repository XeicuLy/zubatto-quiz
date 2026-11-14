import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/errors';

import { renderInRouter } from '../../../test/render-in-router';
import { LoadErrorCard } from './LoadErrorCard';

const FAILED = '問題セットを読めませんでした';

const NOT_FOUND = {
  title: '問題セットが見つかりません',
  detail: '消されたか、URL が違います。',
  back: { to: '/admin', label: '問題セットの一覧に戻る' },
} as const;

describe('LoadErrorCard', () => {
  it('ログインが切れた（401）なら、ログインし直すリンクを出す', async () => {
    await renderInRouter(<LoadErrorCard error={new ApiError(401)} failed={FAILED} retry={() => {}} titleAs="h1" />);

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 1, name: 'ログインが切れました' })).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: 'ログインし直す' })).toHaveAttribute('href', '/login');
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
  });

  it('404 で notFound を渡したら、見出し・説明・戻るリンクを出す', async () => {
    await renderInRouter(
      <LoadErrorCard error={new ApiError(404)} failed={FAILED} retry={() => {}} notFound={NOT_FOUND} titleAs="h1" />,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { name: NOT_FOUND.title })).toBeInTheDocument();
    expect(alert).toHaveTextContent(NOT_FOUND.detail);
    expect(within(alert).getByRole('link', { name: NOT_FOUND.back.label })).toHaveAttribute('href', '/admin');
  });

  it.each([
    ['届かなかった', new TypeError('Failed to fetch')],
    ['5xx', new ApiError(500)],
    ['notFound を渡していない 404', new ApiError(404)],
  ])('%s なら failed を見出しにし、「もう一度読む」で retry を呼ぶ', async (_, error) => {
    const retry = vi.fn<() => void>();
    await renderInRouter(<LoadErrorCard error={error} failed={FAILED} retry={retry} titleAs="h1" />);

    expect(screen.getByRole('heading', { name: FAILED })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読む' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('画面の見出しの下に置くときは、見出しにしない（titleAs="p"）', async () => {
    await renderInRouter(<LoadErrorCard error={new ApiError(500)} failed={FAILED} retry={() => {}} titleAs="p" />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(FAILED);
  });
});
