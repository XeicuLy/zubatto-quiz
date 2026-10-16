import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
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
  // ログインしていない人として開く。/admin はログイン画面へ移り、そこの見出しを出す
  beforeEach(() => {
    stubFakeApi({ hostName: null });
  });

  it.each([
    ['/', 'ズバクイ'],
    ['/admin', 'ホストの管理画面'],
    ['/rooms/room-1/host', '進行画面'],
    [`/r/${'a'.repeat(64)}`, 'ズバッとクイズ'],
  ])('%s を開くと、見出し「%s」を出す', async (path, heading) => {
    await renderAt(path);

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('知らない経路を開くと、日本語で「ページが見つかりません」と出す（SC3）', async () => {
    await renderAt('/no-such-page');

    expect(await screen.findByRole('heading', { level: 1, name: 'ページが見つかりません' })).toBeInTheDocument();
  });

  it('画面の描画でエラーが起きると、日本語で「エラーが起きました」と出す（SC3）', () => {
    render(<ErrorScreen />);

    expect(screen.getByRole('heading', { level: 1, name: 'エラーが起きました' })).toBeInTheDocument();
  });
});
