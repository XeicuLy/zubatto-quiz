import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { QuestionSetSummary } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { stubFakeApi } from '../../../test/fake-api';
import { createAppRouter } from '../../router';
import { DRAFT_QUESTION_SET } from './api';
import { hostSessionQueryOptions } from './host-session';

const QUIZ: QuestionSetSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '2026 内輪クイズ',
  questionCount: 10,
  // 日本の時刻で12月1日の12時
  updatedAt: '2026-12-01T03:00:00.000Z',
};
const WELCOME: QuestionSetSummary = {
  id: '22222222-2222-4222-8222-222222222222',
  title: '新人歓迎会クイズ',
  questionCount: 4,
  // UTC では11月19日だが、日本の時刻では11月20日
  updatedAt: '2026-11-19T15:30:00.000Z',
};

async function openAdmin() {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ['/admin'] }) });
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  return router;
}

const rowOf = async (title: string) => (await screen.findByRole('heading', { level: 2, name: title })).closest('li')!;

describe('問題セットの一覧（F7）', () => {
  it('保存した問題セットを、問題の数と更新した日（日本の時刻）と一緒に並べる', async () => {
    stubFakeApi({ questionSets: [QUIZ, WELCOME] });

    await openAdmin();

    expect(await screen.findByRole('heading', { level: 1, name: '問題セット' })).toBeInTheDocument();
    expect(await rowOf(QUIZ.title)).toHaveTextContent('10問 / 12月1日に更新');
    expect(await rowOf(WELCOME.title)).toHaveTextContent('4問 / 11月20日に更新');
    expect(within(await rowOf(QUIZ.title)).getByRole('link', { name: '編集' })).toHaveAttribute(
      'href',
      `/admin/sets/${QUIZ.id}`,
    );
  });

  it('問題セットがまだなければ、作るよう促す', async () => {
    stubFakeApi({ questionSets: [] });

    await openAdmin();

    expect(await screen.findByText('まだ問題セットがありません')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '問題セットを作る' })).toBeEnabled();
  });

  it('問題セットを作ると、下書きを保存して、その編集画面へ移る', async () => {
    const api = stubFakeApi({ questionSets: [QUIZ] });
    const router = await openAdmin();

    fireEvent.click(await screen.findByRole('button', { name: '問題セットを作る' }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/admin\/sets\/[0-9a-f-]{36}$/));
    expect(api.requestsTo('POST', '/api/question-sets')).toEqual([
      expect.objectContaining({ body: DRAFT_QUESTION_SET }),
    ]);
    expect(await screen.findByRole('heading', { level: 1, name: '問題セットの編集' })).toBeInTheDocument();
  });

  it('消すときは確かめ、「やめる」を押せば何も消さない', async () => {
    const api = stubFakeApi({ questionSets: [QUIZ] });
    await openAdmin();
    const row = await rowOf(QUIZ.title);

    fireEvent.click(within(row).getByRole('button', { name: '消す' }));
    expect(within(row).getByText('本当に消しますか？')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'やめる' }));

    expect(within(row).queryByText('本当に消しますか？')).not.toBeInTheDocument();
    expect(api.received.filter((r) => r.method === 'DELETE')).toEqual([]);
  });

  it('確かめてから消すと、一覧からなくなる', async () => {
    const api = stubFakeApi({ questionSets: [QUIZ, WELCOME] });
    await openAdmin();
    const row = await rowOf(QUIZ.title);

    fireEvent.click(within(row).getByRole('button', { name: '消す' }));
    fireEvent.click(within(row).getByRole('button', { name: '本当に消す' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: QUIZ.title })).not.toBeInTheDocument());
    expect(api.requestsTo('DELETE', `/api/question-sets/${QUIZ.id}`)).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: WELCOME.title })).toBeInTheDocument();
  });

  it('ログインが切れていたら、ログインし直すよう促す', async () => {
    const api = stubFakeApi({ questionSets: [QUIZ] });
    // 画面はログインしていると思っているが、サーバーではセッションが切れている
    const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ['/admin'] }) });
    await router.options.context.queryClient.fetchQuery(hostSessionQueryOptions);
    api.expireSession();
    render(<RouterProvider router={router} />);
    await act(() => router.load());

    expect(await screen.findByRole('alert')).toHaveTextContent('ログインが切れました');
    expect(screen.getByRole('link', { name: 'ログインし直す' })).toHaveAttribute('href', '/login');
  });
});
