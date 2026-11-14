import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { renderInRouter } from '../../../test/render-in-router';
import { ActionError, LoginLink } from './ActionError';

const FAILED = '保存できませんでした。もう一度押してください。';

describe('ActionError', () => {
  it('ログインが切れた（401）なら、既定ではログインし直すリンクを出す', async () => {
    await renderInRouter(<ActionError error={new ApiError(401)} failed={FAILED} />);

    expect(screen.getByRole('alert')).toHaveTextContent('ログインが切れました。');
    expect(screen.getByRole('link', { name: 'ログインし直す' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'ログインし直す' })).not.toHaveAttribute('target');
  });

  it('401 の文と導線は、呼ぶ側が差し替えられる（編集中は別のタブでログインする）', async () => {
    await renderInRouter(
      <ActionError
        error={new ApiError(401)}
        failed={FAILED}
        unauthorized={
          <>
            ログインが切れました。<LoginLink newTab>別のタブでログインし直して</LoginLink>
            から、もう一度保存してください。
          </>
        }
      />,
    );

    const link = screen.getByRole('link', { name: '別のタブでログインし直して' });
    expect(link).toHaveAttribute('href', '/login');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'ログインが切れました。別のタブでログインし直してから、もう一度保存してください。',
    );
  });

  it('404 は、notFound を渡せばその文を、渡さなければ failed を出す', async () => {
    const { unmount } = await renderInRouter(
      <ActionError error={new ApiError(404)} failed={FAILED} notFound="この問題セットは消されています。" />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('この問題セットは消されています。');
    unmount();

    await renderInRouter(<ActionError error={new ApiError(404)} failed={FAILED} />);
    expect(screen.getByRole('alert')).toHaveTextContent(FAILED);
  });

  it.each([
    ['届かなかった', new TypeError('Failed to fetch')],
    ['5xx', new ApiError(503)],
    ['そのほか', new ApiError(400)],
  ])('%s なら failed を出し、リンクは出さない', async (_, error) => {
    await renderInRouter(<ActionError error={error} failed={FAILED} />);

    expect(screen.getByRole('alert')).toHaveTextContent(FAILED);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('置く場所の class を足せる', async () => {
    await renderInRouter(<ActionError error={new ApiError(500)} failed={FAILED} className="order-last w-full" />);

    expect(screen.getByRole('alert')).toHaveClass('order-last', 'w-full', 'text-destructive');
  });
});
