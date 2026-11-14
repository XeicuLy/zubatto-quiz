import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import type { QuestionSet } from '@zubatto-quiz/protocol';
import { useState } from 'react';
import { flushSync } from 'react-dom';

import { createQuestionSet, questionSetsQueryOptions, saveQuestionSet } from '@/api/question-sets';
import { notify } from '@/shared/feedback/notify';

import type { QuestionSetDraft } from './question-set-draft';

/** 保存できたあと、編集画面に留まる（stay）か、問題セットの一覧へ移る（list）か */
export type SaveIntent = 'stay' | 'list';

interface UseQuestionSetSaveOptions {
  /** 開いた問題セットの ID。まだ作っていない問題セット（/admin/sets/new）では undefined */
  setId: string | undefined;
  /** いまの下書き。最後に保存できた下書きと同じものかどうかで、保存していない変更の有無を決める */
  draft: QuestionSetDraft;
}

/** 離れるのを止めるかどうかは disabled で切り替える。関数は描くたびに作り直さない（作り直すと登録し直しになる） */
const blockNavigation = () => true;

/**
 * 問題セットの保存と、保存していない変更があるうちに離れる前の確かめ（F7）。
 *
 * まだ作っていない問題セットは、最初の保存で作り（POST）、そのあとは書き換える（PUT）。
 * 作れたら、/admin/sets/new を履歴に残さないよう置き換えて移る。戻る操作で空の作成画面に戻らないため。
 * 移った先では編集画面が作り直されるので、「保存する」を押したときは、移った先の「保存する」にフォーカスを頼む。
 *
 * 移る前には、保存済みの下書きを直しておく。useBlocker は disabled を effect の中で読むので、
 * 直した描画が commit されて effect が走る前に移ると、まだ保存していない扱いのまま止められ、確かめが出てしまう
 */
export function useQuestionSetSave({ setId, draft }: UseQuestionSetSaveOptions) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // 最後に保存できた下書き。reducer は変えるたびに新しい下書きを返すので、同じものかどうかで変更の有無が分かる
  const [savedDraft, setSavedDraft] = useState(draft);
  // 保存先の ID。作れたら、移る前にここへ入れる。移り終える前にもう一度押されても、2つ目を作らず書き換えるため
  const [savedId, setSavedId] = useState(setId);
  const dirty = draft !== savedDraft;

  const mutation = useMutation({
    mutationFn: async (input: QuestionSet): Promise<{ id: string; created: boolean }> => {
      if (savedId === undefined) {
        return { id: await createQuestionSet(input), created: true };
      }
      await saveQuestionSet(savedId, input);
      return { id: savedId, created: false };
    },
    // 一覧の名前・問題の数・並び（更新の新しい順）が変わる。作ったなら行が増える
    onSuccess: () => queryClient.invalidateQueries({ queryKey: questionSetsQueryOptions.queryKey }),
  });

  const blocker = useBlocker({ shouldBlockFn: blockNavigation, disabled: !dirty, withResolver: true });

  /** 画面で questionSetSchema に通した input を送る。送ったときの下書きを覚え、保存のあいだに打った分は変更として残す */
  function save(input: QuestionSet, intent: SaveIntent) {
    const sent = draft;
    mutation.mutate(input, {
      onSuccess: ({ id, created }) => {
        // 同期で描き、blocker の effect まで済ませてから移る（同期の更新では、React が commit の最後に effect を流す）
        flushSync(() => {
          setSavedDraft(sent);
          setSavedId(id);
        });
        notify(created ? `「${input.title}」を作りました` : `「${input.title}」を保存しました`);
        // /admin/sets/new にいるあいだは、作ったあとも置き換えて移る。保存のあいだに打って確かめで留まったあと、押し直したときも移れるように
        const onNewPage = setId === undefined;
        if (intent === 'list') {
          void navigate({ to: '/admin', replace: onNewPage });
        } else if (onNewPage) {
          void navigate({ to: '/admin/sets/$setId', params: { setId: id }, replace: true, state: { focusSave: true } });
        }
      },
    });
  }

  return { save, dirty, blocker, isPending: mutation.isPending, error: mutation.error };
}
