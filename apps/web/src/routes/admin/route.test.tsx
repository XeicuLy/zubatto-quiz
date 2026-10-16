import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { stubFakeApi } from '../../../test/fake-api';
import { createAppRouter } from '../../router';

async function openAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  return router;
}

describe('管理画面のログインの確認（S1）', () => {
  it.each(['/admin', '/admin/sets/11111111-1111-4111-8111-111111111111'])(
    'ログインしていないと、%s を開いてもログイン画面へ移り、問題セットを読みにいかない',
    async (path) => {
      const api = stubFakeApi({ hostName: null });

      const router = await openAt(path);

      expect(router.state.location.pathname).toBe('/login');
      expect(await screen.findByRole('button', { name: 'GitHub でログイン' })).toBeInTheDocument();
      expect(api.received.filter((r) => r.path.startsWith('/api/question-sets'))).toEqual([]);
    },
  );

  it('別のタブでのログアウトなどでセッションが切れたあとは、管理画面の中を移るときにログイン画面へ移す', async () => {
    const api = stubFakeApi({ hostName: 'XeicuLy' });
    const router = await openAt('/admin');
    expect(await screen.findByRole('banner')).toHaveTextContent('XeicuLy');

    api.expireSession();
    await act(() =>
      router.navigate({ to: '/admin/sets/$setId', params: { setId: '11111111-1111-4111-8111-111111111111' } }),
    );

    expect(router.state.location.pathname).toBe('/login');
  });

  it('ログインしていれば、ホストの名前とログアウトのボタンを出す', async () => {
    stubFakeApi({ hostName: 'XeicuLy' });

    await openAt('/admin');

    expect(await screen.findByRole('banner')).toHaveTextContent('XeicuLy');
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument();
  });

  it('ログアウトすると、ログイン画面へ移り、もう管理画面を開けない', async () => {
    const api = stubFakeApi({ hostName: 'XeicuLy' });
    const router = await openAt('/admin');

    fireEvent.click(await screen.findByRole('button', { name: 'ログアウト' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(api.requestsTo('POST', '/api/auth/sign-out')).toHaveLength(1);

    // 前のセッションを覚えたままだと、ここで管理画面が開いてしまう
    await act(() => router.navigate({ to: '/admin' }));
    expect(router.state.location.pathname).toBe('/login');
  });
});
