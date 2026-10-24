import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { stubFakeApi } from '../../test/fake-api';
import { ErrorScreen } from '../components/error-screen';
import { createAppRouter } from '../router';

async function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

describe('画面の経路', () => {
  // ログインしていない人として開く。/admin と進行画面はログイン画面へ移り、そこの見出しを出す
  beforeEach(() => {
    stubFakeApi({ hostName: null });
  });

  // タイトルに部屋の ID や名前を入れない（S3）
  it.each([
    ['/', 'ズバクイ', 'ズバクイ'],
    ['/admin', 'ホストの管理画面', 'ログイン | ズバクイ'],
    [`/rooms/${'a'.repeat(64)}/host`, 'ホストの管理画面', 'ログイン | ズバクイ'],
    [`/r/${'a'.repeat(64)}`, 'ズバッとクイズ', 'クイズに参加 | ズバクイ'],
  ])('%s を開くと、見出し「%s」とタイトル「%s」を出す', async (path, heading, title) => {
    await renderAt(path);

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe(title));
  });

  it('知らない経路を開くと、日本語で「ページが見つかりません」と出す（SC3）', async () => {
    await renderAt('/no-such-page');

    expect(await screen.findByRole('heading', { level: 1, name: 'ページが見つかりません' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('ズバクイ'));
  });

  it('画面を移ると、タイトルも移った先の画面の名前に替わる', async () => {
    const router = await renderAt('/');
    await waitFor(() => expect(document.title).toBe('ズバクイ'));

    await act(() => router.navigate({ to: '/login' }));

    await waitFor(() => expect(document.title).toBe('ログイン | ズバクイ'));
  });

  it('画面の描画でエラーが起きると、日本語で「エラーが起きました」と出す（SC3）', () => {
    render(<ErrorScreen />);

    expect(screen.getByRole('heading', { level: 1, name: 'エラーが起きました' })).toBeInTheDocument();
  });
});
