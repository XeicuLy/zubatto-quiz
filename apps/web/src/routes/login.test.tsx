import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { stubFakeApi } from '../../test/fake-api';
import { createAppRouter } from '../router';

async function openAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  return router;
}

describe('ホストのログイン画面（ADR 0003）', () => {
  it('GitHub でログインするボタンを出す', async () => {
    stubFakeApi({ hostName: null });

    await openAt('/login');

    expect(await screen.findByRole('heading', { level: 1, name: 'ホストの管理画面' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('ログイン | ズバクイ'));
    expect(screen.getByRole('button', { name: 'GitHub でログイン' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('許可リストの外で拒否されて戻ってきたら、ホストとして登録されていないことを知らせる（S1）', async () => {
    stubFakeApi({ hostName: null });

    await openAt('/login?error=host_not_allowed');

    expect(await screen.findByRole('alert')).toHaveTextContent('このアカウントはホストとして登録されていません');
    expect(screen.getByRole('button', { name: '別のアカウントでログイン' })).toBeEnabled();
  });

  it('ほかの理由でログインに失敗して戻ってきたら、やり直しを促す', async () => {
    stubFakeApi({ hostName: null });

    await openAt('/login?error=access_denied');

    expect(await screen.findByRole('alert')).toHaveTextContent('ログインできませんでした');
    expect(screen.getByRole('alert')).not.toHaveTextContent('ホストとして登録されていません');
  });

  it('もうログインしていれば、管理画面へ移す', async () => {
    stubFakeApi({ hostName: 'XeicuLy' });

    const router = await openAt('/login');

    expect(router.state.location.pathname).toBe('/admin');
  });
});
