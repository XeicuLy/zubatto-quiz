import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterContextProvider } from '@tanstack/react-router';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { QuestionSetDetail } from '@zubatto-quiz/protocol';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';
import { createAppRouter } from '@/router';

import { stubFakeApi } from '../../../test/fake-api';
import { draftOf, editorReducer, emptyDraft, type QuestionSetDraft, validateDraft } from './question-set-draft';
import { useQuestionSetSave } from './use-question-set-save';

const SET: QuestionSetDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '2026 内輪クイズ',
  questions: [{ text: '部長の十八番は？', choices: ['演歌', 'アニソン'], correctIndex: 1, limitMs: 10_000 }],
};

const EDIT_PATH = `/admin/sets/${SET.id}`;
const NEW_PATH = '/admin/sets/new';

/**
 * hook を、編集画面の経路にいる router の中で動かす。ルートは描かない（一覧の loader も動かない）ので、
 * 移ったかどうかは history の場所で見る。下書きは props で渡し、打ったことは rerender で表す。
 * setId を渡さなければ、まだ作っていない問題セット（/admin/sets/new）として、空の下書きから始める
 */
function renderSave(setId: string | undefined) {
  const path = setId === undefined ? NEW_PATH : `/admin/sets/${setId}`;
  // 一覧から移ってきたことにする。置き換えて移ったか（replace）を、history の長さで見るため
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: ['/admin', path] }) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RouterContextProvider router={router}>
      <QueryClientProvider client={router.options.context.queryClient}>{children}</QueryClientProvider>
    </RouterContextProvider>
  );
  const initial = setId === undefined ? emptyDraft() : draftOf(SET);
  const hook = renderHook((props: { draft: QuestionSetDraft }) => useQuestionSetSave({ setId, draft: props.draft }), {
    initialProps: { draft: initial },
    wrapper,
  });
  return { ...hook, router, initial };
}

/** 空の下書きに、保存できる中身を入れたもの（SET と同じ問題）と、それを送る形にしたもの */
function filled(title: string) {
  const draft = { ...draftOf(SET), title };
  const validation = validateDraft(draft);
  if (!validation.ok) {
    throw new Error('テストの下書きが通らない');
  }
  return { draft, input: validation.input };
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
    const { result } = renderSave(SET.id);

    expect(result.current.dirty).toBe(false);
  });

  it('「保存して一覧へ」は、保存済みの下書きを直してから一覧へ移るので、離れる確かめが出ない', async () => {
    const api = stubFakeApi({ questionSetDetails: [SET] });
    const { result, rerender, router, initial } = renderSave(SET.id);
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
    const { result, rerender, router, initial } = renderSave(SET.id);
    const edited = renamed(initial, '書き換えた名前');
    rerender({ draft: edited.draft });

    act(() => result.current.save(edited.input, 'stay'));

    await waitFor(() => expect(result.current.dirty).toBe(false));
    expect(api.requestsTo('PUT', `/api/question-sets/${SET.id}`)).toHaveLength(1);
    expect(router.history.location.pathname).toBe(EDIT_PATH);
  });

  it('保存のあいだに打った分は保存していない変更として残し、「保存して一覧へ」でも離れる前に確かめる', async () => {
    stubFakeApi({ questionSetDetails: [SET] });
    const { result, rerender, router, initial } = renderSave(SET.id);
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
    const { result, rerender, router, initial } = renderSave(SET.id);
    const edited = renamed(initial, '消えては困る名前');
    rerender({ draft: edited.draft });

    api.expireSession();
    act(() => result.current.save(edited.input, 'list'));

    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
    expect(result.current.dirty).toBe(true);
    expect(router.history.location.pathname).toBe(EDIT_PATH);
  });
});

describe('まだ作っていない問題セットの保存（useQuestionSetSave、setId なし）', () => {
  it('開いたばかりなら、保存していない変更はない', () => {
    stubFakeApi();
    const { result } = renderSave(undefined);

    expect(result.current.dirty).toBe(false);
  });

  it('「保存する」は作って（POST）、その編集画面へ置き換えて移り、移った先の「保存する」にフォーカスを頼む', async () => {
    const api = stubFakeApi();
    const { result, rerender, router } = renderSave(undefined);
    const edited = filled('新しく作る問題セット');
    rerender({ draft: edited.draft });
    const length = router.history.length;

    act(() => result.current.save(edited.input, 'stay'));

    await waitFor(() => expect(router.history.location.pathname).toMatch(/^\/admin\/sets\/[0-9a-f-]{36}$/));
    expect(api.requestsTo('POST', '/api/question-sets').map((request) => request.body)).toEqual([edited.input]);
    expect(api.received.filter((request) => request.method === 'PUT')).toEqual([]);
    // 置き換えたので、戻る操作で空の作成画面に戻らない
    expect(router.history.length).toBe(length);
    expect(router.history.location.state.focusSave).toBe(true);
    expect(result.current.blocker.status).toBe('idle');
  });

  it('作ったあとにもう一度保存すると、もう1つ作らずに、作ったセットを書き換える（PUT）', async () => {
    const api = stubFakeApi();
    const { result, rerender, router } = renderSave(undefined);
    const first = filled('1回目の名前');
    rerender({ draft: first.draft });
    act(() => result.current.save(first.input, 'stay'));
    await waitFor(() => expect(router.history.location.pathname).not.toBe(NEW_PATH));
    const setId = router.history.location.pathname.split('/').at(-1)!;

    const second = renamed(first.draft, '2回目の名前');
    rerender({ draft: second.draft });
    act(() => result.current.save(second.input, 'stay'));

    await waitFor(() => expect(result.current.dirty).toBe(false));
    expect(api.requestsTo('POST', '/api/question-sets')).toHaveLength(1);
    expect(api.requestsTo('PUT', `/api/question-sets/${setId}`).map((request) => request.body)).toEqual([second.input]);
  });

  it('「保存して一覧へ」は、作ってから一覧へ置き換えて移る', async () => {
    const api = stubFakeApi();
    const { result, rerender, router } = renderSave(undefined);
    const edited = filled('書き終えた問題セット');
    rerender({ draft: edited.draft });
    const length = router.history.length;

    act(() => result.current.save(edited.input, 'list'));

    await waitFor(() => expect(router.history.location.pathname).toBe('/admin'));
    expect(api.requestsTo('POST', '/api/question-sets')).toHaveLength(1);
    expect(router.history.length).toBe(length);
    expect(result.current.blocker.status).toBe('idle');
  });
});
