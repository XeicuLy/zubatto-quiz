import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAppRouter } from '@/router';

import { stubFakeApi } from '../../test/fake-api';

async function openTop() {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  return router;
}

describe('入口の経路（/）', () => {
  it('ログインしていなければ、ホストとしてログインするボタンを出す', async () => {
    stubFakeApi({ hostName: null });

    await openTop();

    expect(await screen.findByRole('button', { name: 'ホストとしてログイン' })).toBeInTheDocument();
  });

  it('ログインしていても管理画面へは移さず、問題セットの一覧へのリンクを出す', async () => {
    stubFakeApi({ hostName: 'XeicuLy' });

    const router = await openTop();

    expect(await screen.findByRole('link', { name: '問題セットへ' })).toHaveAttribute('href', '/admin');
    expect(router.state.location.pathname).toBe('/');
  });

  it('セッションを読めなくても、エラーの画面にせず、ログインしていないとして入口を出す', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 500 }));

    const router = await openTop();

    expect(await screen.findByRole('button', { name: 'ホストとしてログイン' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});
