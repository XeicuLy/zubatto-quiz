import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { QuestionSetSummary } from '@zubatto-quiz/protocol';
import { describe, expect, it } from 'vitest';

import { stubFakeApi } from '../../../test/fake-api';
import { FakeRoomServer } from '../../../test/fake-room-server';
import { createAppRouter } from '../../router';

const QUIZ: QuestionSetSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '2026 内輪クイズ',
  questionCount: 10,
  updatedAt: '2026-12-01T03:00:00.000Z',
};

/** 「部屋を作る」は一覧の行にあり、押すと進行画面へ移るので、router ごと開く */
async function openAdmin() {
  const server = new FakeRoomServer();
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ['/admin'] }),
    createRoomSocket: server.createSocket,
  });
  render(<RouterProvider router={router} />);
  await act(() => router.load());
  const row = (await screen.findByRole('heading', { level: 2, name: QUIZ.title })).closest('li')!;
  return { router, row };
}

describe('部屋を作る（F1）', () => {
  it('押すと、その問題セットから部屋を作り、その部屋の進行画面へ移る', async () => {
    const api = stubFakeApi({ questionSets: [QUIZ] });
    const { router, row } = await openAdmin();

    fireEvent.click(within(row).getByRole('button', { name: '部屋を作る' }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/rooms\/[0-9a-f]{64}\/host$/));
    expect(api.requestsTo('POST', '/api/rooms')).toEqual([
      expect.objectContaining({ body: { questionSetId: QUIZ.id } }),
    ]);
  });

  it('ログインが切れていたら、移らずにログインし直すよう促す', async () => {
    const api = stubFakeApi({ questionSets: [QUIZ] });
    const { router, row } = await openAdmin();

    api.expireSession();
    fireEvent.click(within(row).getByRole('button', { name: '部屋を作る' }));

    expect(await within(row).findByRole('alert')).toHaveTextContent('ログインが切れました');
    expect(within(row).getByRole('link', { name: 'ログインし直す' })).toHaveAttribute('href', '/login');
    expect(router.state.location.pathname).toBe('/admin');
  });

  it('別のタブで消した問題セットなら、一覧を読み直して行を消す', async () => {
    const api = stubFakeApi({ questionSets: [QUIZ] });
    const { row } = await openAdmin();

    // 別のタブで消したことにする
    await fetch(`/api/question-sets/${QUIZ.id}`, { method: 'DELETE' });
    fireEvent.click(within(row).getByRole('button', { name: '部屋を作る' }));

    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: QUIZ.title })).toBeNull());
    expect(api.requestsTo('POST', '/api/rooms')).toHaveLength(1);
  });
});
