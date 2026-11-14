import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { QuestionSetDetail } from '@zubatto-quiz/protocol';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';
import { createAppRouter } from '@/router';

import { stubFakeApi } from '../../../test/fake-api';
import { draftOf, editorReducer, type QuestionSetDraft, validateDraft } from './question-set-draft';
import { useQuestionSetSave } from './use-question-set-save';

const SET: QuestionSetDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '2026 内輪クイズ',
  questions: [{ text: '部長の十八番は？', choices: ['演歌', 'アニソン'], correctIndex: 1, limitMs: 10_000 }],
};

const EDIT_PATH = `/admin/sets/${SET.id}`;

/**
 * hook を、編集画面の経路にいる router の中で動かす。ルートは描かない（一覧の loader も動かない）ので、
 * 移ったかどうかは history の場所で見る。下書きは props で渡し、打ったことは rerender で表す
 */
function renderSave() {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [EDIT_PATH] }) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RouterContextProvider router={router}>
      <QueryClientProvider client={router.options.context.queryClient}>{children}</QueryClientProvider>
    </RouterContextProvider>
  );
  const initial = draftOf(SET);
  const hook = renderHook(
    (props: { draft: QuestionSetDraft }) => useQuestionSetSave({ setId: SET.id, draft: props.draft }),
    {
      initialProps: { draft: initial },
      wrapper,
    },
  );
  return { ...hook, router, initial };
}

/** 名前を書き換えた下書きと、それを送る形にしたもの */
function renamed(draft: QuestionSetDraft, title: string) {
  const next = editorReducer(draft, { type: 'setTitle', title });
  const validation = validateDraft(next);
  if (!validation.ok) {
    throw new Error('テストの下書きが通らない');
  }
  return { draft: next, input: validation.input };
}

describe('問題セットの保存（useQuestionSetSave）', () => {
  it('開いたばかりなら、保存していない変更はない', () => {
    stubFakeApi({ questionSetDetails: [SET] });
    const { result } = renderSave();

    expect(result.current.dirty).toBe(false);
  });

  it('「保存して一覧へ」は、保存済みの下書きを直してから一覧へ移るので、離れる確かめが出ない', async () => {
    const api = stubFakeApi({ questionSetDetails: [SET] });
    const { result, rerender, router, initial } = renderSave();
    const edited = renamed(initial, '書き換えた名前');
    rerender({ draft: edited.draft });
    expect(result.current.dirty).toBe(true);

    act(() => result.current.save(edited.input, 'list'));

    await waitFor(() => expect(router.history.location.pathname).toBe('/admin'));
    expect(result.current.blocker.status).toBe('idle');
    expect(result.current.dirty).toBe(false);
    expect(api.requestsTo('PUT', `/api/question-sets/${SET.id}`).map((request) => request.body)).toEqual([
      edited.input,
    ]);
  });

  it('「保存する」は、保存しても編集画面に留まる', async () => {
    const api = stubFakeApi({ questionSetDetails: [SET] });
    const { result, rerender, router, initial } = renderSave();
    const edited = renamed(initial, '書き換えた名前');
    rerender({ draft: edited.draft });

    act(() => result.current.save(edited.input, 'stay'));

    await waitFor(() => expect(result.current.dirty).toBe(false));
    expect(api.requestsTo('PUT', `/api/question-sets/${SET.id}`)).toHaveLength(1);
    expect(router.history.location.pathname).toBe(EDIT_PATH);
  });

  it('保存のあいだに打った分は保存していない変更として残し、「保存して一覧へ」でも離れる前に確かめる', async () => {
    stubFakeApi({ questionSetDetails: [SET] });
    const { result, rerender, router, initial } = renderSave();
    const sent = renamed(initial, '送った名前');
    rerender({ draft: sent.draft });

    act(() => result.current.save(sent.input, 'list'));
    // PUT の応答より先に打つ
    rerender({ draft: renamed(sent.draft, '保存のあいだに打った名前').draft });

    await waitFor(() => expect(result.current.blocker.status).toBe('blocked'));
    expect(result.current.dirty).toBe(true);
    expect(router.history.location.pathname).toBe(EDIT_PATH);
  });

  it('保存できなければ、移らず、保存していない変更のまま失敗を返す', async () => {
    const api = stubFakeApi({ questionSetDetails: [SET] });
    const { result, rerender, router, initial } = renderSave();
    const edited = renamed(initial, '消えては困る名前');
    rerender({ draft: edited.draft });

    api.expireSession();
    act(() => result.current.save(edited.input, 'list'));

    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
    expect(result.current.dirty).toBe(true);
    expect(router.history.location.pathname).toBe(EDIT_PATH);
  });
});
