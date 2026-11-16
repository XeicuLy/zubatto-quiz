import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Host } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { createAppRouter } from '@/router';

import { stubFakeApi } from '../../../test/fake-api';

const ADMIN: Host = { githubUserId: '1000', note: 'XeicuLy', isAdmin: true, createdAt: '2026-11-01T03:00:00.000Z' };
const ALICE: Host = { githubUserId: '1001', note: 'alice', isAdmin: false, createdAt: '2026-11-02T03:00:00.000Z' };

async function openHosts() {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ['/admin/hosts'] }) });
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  await screen.findByRole('heading', { level: 2, name: 'XeicuLy' });
}

const input = () => screen.getByRole('textbox', { name: 'GitHub のユーザー名' });

function submit(login: string) {
  fireEvent.change(input(), { target: { value: login } });
  fireEvent.click(screen.getByRole('button', { name: 'ホストに追加する' }));
}

describe('ホストを足す（ADR 0013）', () => {
  it('GitHub のユーザー名で足すと、一覧に加わり、toast で知らせ、欄を空にする', async () => {
    const api = stubFakeApi({ isAdmin: true, hosts: [ADMIN], githubUsers: { Octocat: '583231' } });
    await openHosts();

    submit('octocat');

    expect(await screen.findByRole('heading', { level: 2, name: 'Octocat' })).toBeInTheDocument();
    expect(api.requestsTo('POST', '/api/admin/hosts')).toEqual([
      expect.objectContaining({ body: { login: 'octocat' } }),
    ]);
    const toasts = screen.getByRole('region', { name: '通知' });
    // 名前は、GitHub が返した書き方で出す
    expect(await within(toasts).findByText('「Octocat」をホストに追加しました')).toBeVisible();
    expect(input()).toHaveValue('');
  });

  it('先頭の @ は1つ外して送る', async () => {
    const api = stubFakeApi({ isAdmin: true, hosts: [ADMIN], githubUsers: { octocat: '583231' } });
    await openHosts();

    submit(' @octocat ');

    expect(await screen.findByRole('heading', { level: 2, name: 'octocat' })).toBeInTheDocument();
    expect(api.requestsTo('POST', '/api/admin/hosts')).toEqual([
      expect.objectContaining({ body: { login: 'octocat' } }),
    ]);
  });

  it.each([
    ['空', '  ', 'GitHub のユーザー名を入れてください。'],
    ['使えない文字', '../orgs/x', 'GitHub のユーザー名は、英数字とハイフンの39文字までです。'],
    ['40文字', 'x'.repeat(40), 'GitHub のユーザー名は、英数字とハイフンの39文字までです。'],
  ])('%s なら、送らずに欄の下に誤りを出す', async (_, login, message) => {
    const api = stubFakeApi({ isAdmin: true, hosts: [ADMIN] });
    await openHosts();

    submit(login);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(input()).toHaveAccessibleDescription(message);
    expect(api.requestsTo('POST', '/api/admin/hosts')).toEqual([]);
  });

  it.each([
    ['GitHub にいない（404）', {}, 'nobody', 'GitHub にこのユーザーが見つかりません。名前を確かめてください。'],
    ['もうホストにいる（409）', { alice: '1001' }, 'alice', 'この人はもうホストです。'],
  ])('%s なら、欄の下に誤りを出し、入れた名前を残す', async (_, githubUsers, login, message) => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN, ALICE], githubUsers });
    await openHosts();

    submit(login);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(input()).toHaveAccessibleDescription(message);
    expect(input()).toHaveValue(login);
  });

  it('別のタブで先に足されていた（409）なら、一覧を読み直して、その人を見せる', async () => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN] });
    await openHosts();
    // 一覧を読んだあとに、別のタブで足された
    stubFakeApi({ isAdmin: true, hosts: [ADMIN, ALICE], githubUsers: { alice: '1001' } });

    submit('alice');

    expect(await screen.findByRole('heading', { level: 2, name: 'alice' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('この人はもうホストです。');
  });

  it('GitHub が答えない（502）なら、ボタンのそばに、時間をおくよう促す誤りを出す', async () => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN], githubUnavailable: true });
    await openHosts();

    submit('octocat');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '追加できませんでした。GitHub に問い合わせられなかったので、少し待ってからもう一度押してください。',
    );
    expect(input()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('ログインが切れていたら、ボタンのそばに、ログインし直す導線を出す', async () => {
    const api = stubFakeApi({ isAdmin: true, hosts: [ADMIN], githubUsers: { octocat: '583231' } });
    await openHosts();
    api.expireSession();

    submit('octocat');

    expect(await screen.findByRole('alert')).toHaveTextContent('ログインが切れました');
    expect(screen.getByRole('link', { name: 'ログインし直す' })).toHaveAttribute('href', '/login');
  });

  it('「@ octocat」のように @ のあとに空白があっても、送る名前と欄の名前をそろえて扱う', async () => {
    const api = stubFakeApi({
      isAdmin: true,
      hosts: [ADMIN, ALICE],
      githubUsers: { octocat: '583231', alice: '1001' },
    });
    await openHosts();

    // 404・409 の誤りは、送った名前についての誤りとして欄の下に出る
    submit('@ nobody');
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub にこのユーザーが見つかりません。');
    submit('@ alice');
    expect(await screen.findByRole('alert')).toHaveTextContent('この人はもうホストです。');

    // 追加できたら、欄を空にする
    submit('@ octocat');
    expect(await screen.findByRole('heading', { level: 2, name: 'octocat' })).toBeInTheDocument();
    expect(input()).toHaveValue('');
    expect(api.requestsTo('POST', '/api/admin/hosts').map((r) => r.body)).toEqual([
      { login: 'nobody' },
      { login: 'alice' },
      { login: 'octocat' },
    ]);
  });

  it.each([
    ['形の誤り', '../x'],
    ['GitHub にいない（404）', 'nobody'],
  ])('%s を欄の下に出したあと、打ち直したら誤りを消す', async (_, login) => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN] });
    await openHosts();
    submit(login);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.change(input(), { target: { value: 'bob' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('送っているあいだに打ち替えたら、先の 404 を打ち替えた名前の下に出さない', async () => {
    const api = stubFakeApi({ isAdmin: true, hosts: [ADMIN] });
    await openHosts();

    submit('nobody');
    fireEvent.change(input(), { target: { value: 'bob' } });
    // 先の要求の答え（404）が届くのを待つ
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(api.requestsTo('POST', '/api/admin/hosts')).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input()).toHaveValue('bob');
  });

  it('送っているあいだに打ち替えた名前は、先の成功で消さない', async () => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN], githubUsers: { octocat: '583231' } });
    await openHosts();

    submit('octocat');
    fireEvent.change(input(), { target: { value: 'bob' } });

    expect(await screen.findByRole('heading', { level: 2, name: 'octocat' })).toBeInTheDocument();
    expect(input()).toHaveValue('bob');
  });

  it('前の誤りは、もう一度押したときに消す', async () => {
    stubFakeApi({ isAdmin: true, hosts: [ADMIN], githubUsers: { octocat: '583231' } });
    await openHosts();
    submit('nobody');
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    submit('octocat');

    expect(await screen.findByRole('heading', { level: 2, name: 'octocat' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
