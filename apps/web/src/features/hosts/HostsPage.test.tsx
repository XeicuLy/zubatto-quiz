import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Host } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { createAppRouter } from '@/router';

import { stubFakeApi } from '../../../test/fake-api';

const ADMIN: Host = { githubUserId: '1000', note: 'XeicuLy', isAdmin: true, createdAt: '2026-11-01T03:00:00.000Z' };
const ALICE: Host = {
  githubUserId: '1001',
  note: 'alice',
  isAdmin: false,
  // UTC では11月14日だが、日本の時刻では11月15日
  createdAt: '2026-11-14T15:30:00.000Z',
};
/** コマンドで足したホストは、メモがないことがある */
const NO_NOTE: Host = { githubUserId: '1002', note: null, isAdmin: false, createdAt: '2026-11-03T03:00:00.000Z' };

async function openAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  return router;
}

const rowOf = async (name: string) => (await screen.findByRole('heading', { level: 2, name })).closest('li')!;

describe('ホストの管理の入口（ADR 0013）', () => {
  it('管理者でなければ、/admin/hosts を開いても問題セットの一覧へ移り、許可リストを読みにいかない', async () => {
    const api = stubFakeApi({ isAdmin: false, hosts: [ADMIN] });

    const router = await openAt('/admin/hosts');

    expect(router.state.location.pathname).toBe('/admin');
    expect(await screen.findByRole('heading', { level: 1, name: '問題セット' })).toBeInTheDocument();
    expect(api.received.filter((r) => r.path.startsWith('/api/admin/'))).toEqual([]);
  });

  it('ログインしていなければ、ログイン画面へ移る', async () => {
    stubFakeApi({ hostName: null });

    const router = await openAt('/admin/hosts');

    expect(router.state.location.pathname).toBe('/login');
  });

  it('タブのタイトルは「ホストの管理」で、ホストの名前は入れない（S3）', async () => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN, ALICE] });

    await openAt('/admin/hosts');

    await waitFor(() => expect(document.title).toBe('ホストの管理 | ズバクイ'));
  });

  it('管理者には、上の帯に「問題セット」と「ホストの管理」のリンクを出し、いまの画面に印を付ける', async () => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN] });

    await openAt('/admin/hosts');

    const nav = await screen.findByRole('navigation', { name: '管理画面' });
    expect(within(nav).getByRole('link', { name: '問題セット' })).toHaveAttribute('href', '/admin');
    expect(within(nav).getByRole('link', { name: '問題セット' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'ホストの管理' })).toHaveAttribute('aria-current', 'page');
  });

  it('管理者でなければ、上の帯にリンクを出さない', async () => {
    stubFakeApi({ isAdmin: false });

    await openAt('/admin');

    expect(await screen.findByRole('heading', { level: 1, name: '問題セット' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('navigation')).not.toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'ホストの管理' })).not.toBeInTheDocument();
  });
});

describe('ホストの一覧（ADR 0013）', () => {
  it('足した順に、名前のメモ・GitHub ID・足した日（日本の時刻）を並べる', async () => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN, NO_NOTE, ALICE] });

    await openAt('/admin/hosts');

    expect(await screen.findByRole('heading', { level: 1, name: 'ホストの管理' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'ホスト' });
    expect(
      within(list)
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(['XeicuLy', 'メモなし', 'alice']);
    expect(await rowOf('alice')).toHaveTextContent('GitHub ID 1001 / 2026年11月15日に追加');
    expect(await rowOf('メモなし')).toHaveTextContent('GitHub ID 1002');
  });

  it('管理者の行には「管理者」と出し、外すボタンを出さない', async () => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN, ALICE] });

    await openAt('/admin/hosts');

    const admin = await rowOf('XeicuLy');
    expect(admin).toHaveTextContent('管理者');
    expect(within(admin).queryByRole('button', { name: '外す' })).not.toBeInTheDocument();
    expect(within(await rowOf('alice')).getByRole('button', { name: '外す' })).toBeInTheDocument();
  });

  it('外すときは確かめ、ログインも切れることを伝える。「やめる」なら何も外さず、「外す」へフォーカスを戻す', async () => {
    const api = stubFakeApi({ isAdmin: true, hosts: [ADMIN, ALICE] });
    await openAt('/admin/hosts');
    const row = await rowOf('alice');

    fireEvent.click(within(row).getByRole('button', { name: '外す' }));
    const dialog = within(row).getByRole('alertdialog', { name: '本当に外しますか？' });
    expect(dialog).toHaveAccessibleDescription(
      'その人のログインも切れます。作った問題セットは残り、追加し直せばまた使えます。',
    );
    expect(within(dialog).getByRole('button', { name: 'やめる' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'やめる' }));

    expect(within(row).getByRole('button', { name: '外す' })).toHaveFocus();
    expect(api.received.filter((r) => r.method === 'DELETE')).toEqual([]);
  });

  it('外せたら、消える行の中にあったフォーカスを、見出しへ移す', async () => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN, ALICE] });
    await openAt('/admin/hosts');
    const row = await rowOf('alice');

    fireEvent.click(within(row).getByRole('button', { name: '外す' }));
    // 開いた確かめは「やめる」にフォーカスする。行の中にフォーカスがあるまま確定する
    fireEvent.click(within(row).getByRole('button', { name: '本当に外す' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'alice' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'ホストの管理' })).toHaveFocus();
  });

  it('外すあいだにほかの所へフォーカスを移していたら、見出しへは移さない', async () => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN, ALICE] });
    await openAt('/admin/hosts');
    const row = await rowOf('alice');
    const input = screen.getByRole('textbox', { name: 'GitHub のユーザー名' });

    fireEvent.click(within(row).getByRole('button', { name: '外す' }));
    fireEvent.click(within(row).getByRole('button', { name: '本当に外す' }));
    input.focus();

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'alice' })).not.toBeInTheDocument());
    expect(input).toHaveFocus();
  });

  it('確かめてから外すと、一覧から消え、外した人の名前を toast で知らせる', async () => {
    const api = stubFakeApi({ isAdmin: true, hosts: [ADMIN, ALICE] });
    await openAt('/admin/hosts');
    const row = await rowOf('alice');

    fireEvent.click(within(row).getByRole('button', { name: '外す' }));
    fireEvent.click(within(row).getByRole('button', { name: '本当に外す' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'alice' })).not.toBeInTheDocument());
    expect(api.requestsTo('DELETE', '/api/admin/hosts/1001')).toHaveLength(1);
    const toasts = screen.getByRole('region', { name: '通知' });
    expect(await within(toasts).findByText('「alice」をホストから外しました')).toBeVisible();
  });

  it('メモのない人を外したら、GitHub ID で知らせる', async () => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN, NO_NOTE] });
    await openAt('/admin/hosts');
    const row = await rowOf('メモなし');

    fireEvent.click(within(row).getByRole('button', { name: '外す' }));
    fireEvent.click(within(row).getByRole('button', { name: '本当に外す' }));

    const toasts = screen.getByRole('region', { name: '通知' });
    expect(await within(toasts).findByText('GitHub ID 1002 の人をホストから外しました')).toBeVisible();
  });

  it('別のタブで先に外していた（404）なら、一覧から消えるだけで、toast も誤りも出さない', async () => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN, ALICE] });
    await openAt('/admin/hosts');
    const row = await rowOf('alice');
    stubFakeApi({ isAdmin: true, hosts: [ADMIN] });

    fireEvent.click(within(row).getByRole('button', { name: '外す' }));
    fireEvent.click(within(row).getByRole('button', { name: '本当に外す' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'alice' })).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: '通知' })).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('外せなかったら、行の中に消えない誤りを出す', async () => {
    const api = stubFakeApi({ isAdmin: true, hosts: [ADMIN, ALICE] });
    await openAt('/admin/hosts');
    const row = await rowOf('alice');
    api.expireSession();

    fireEvent.click(within(row).getByRole('button', { name: '外す' }));
    fireEvent.click(within(row).getByRole('button', { name: '本当に外す' }));

    expect(await within(row).findByRole('alert')).toHaveTextContent('ログインが切れました');
    // 一覧を読み直して行ごと消し、誤りを流してしまわない
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(within(row).getByRole('alert')).toHaveTextContent('ログインが切れました');
    // 行は残るので、フォーカスも確かめの中に残る
    expect(within(row).getByRole('button', { name: 'やめる' })).toHaveFocus();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('一覧を読めなかったら、その理由を一覧の場所に出す', async () => {
    const api = stubFakeApi({ isAdmin: true, hosts: [ADMIN] });
    const router = await openAt('/admin/hosts');
    await rowOf('XeicuLy');

    api.expireSession();
    await act(() => router.options.context.queryClient.invalidateQueries({ queryKey: ['admin-hosts'] }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ログインが切れました');
  });
});
