import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker } from '@tanstack/react-router';
import { MAX_QUESTIONS, type QuestionSet, type QuestionSetDetail } from '@zubatto-quiz/protocol';
import { useReducer, useState } from 'react';

import { ApiError } from '@/api/errors';
import { questionSetsQueryOptions, saveQuestionSet } from '@/api/question-sets';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input } from '@/components/ui/field';

import { draftOf, editorReducer, errorSummaryOf, newQuestionKey, validateDraft } from './question-set-draft';
import { QuestionEditor } from './QuestionEditor';

interface QuestionSetEditorProps {
  setId: string;
  /** 開いたときに読んだ問題セット。下書きは、これから1回だけ作る */
  initial: QuestionSetDetail;
}

/** 離れるのを止めるかどうかは disabled で切り替える。関数は描くたびに作り直さない（作り直すと登録し直しになる） */
const blockNavigation = () => true;

/**
 * 問題セットの編集（F4・F7・F9）。下書きは画面の中だけで持ち、「保存する」で丸ごと PUT する。
 *
 * 誤りは、初めて「保存する」を押したときに出し、以後は直すたびに出し直す。打ち始めから赤くしないため。
 * 保存していない変更があるうちは、画面を離れる前に確かめる（経路の移動とタブを閉じる操作の両方）。
 * 管理画面の中の移動は、保存の帯の中身を ConfirmDialog に入れ替えて確かめる。画面を覆わないので、書いた内容を見ながら選べる
 */
export function QuestionSetEditor({ setId, initial }: QuestionSetEditorProps) {
  const queryClient = useQueryClient();
  const [draft, dispatch] = useReducer(editorReducer, initial, draftOf);
  // 最後に保存できた下書き。reducer は変えるたびに新しい下書きを返すので、同じものかどうかで変更の有無が分かる
  const [savedDraft, setSavedDraft] = useState(draft);
  const [showErrors, setShowErrors] = useState(false);

  const validation = validateDraft(draft);
  const errors = showErrors && !validation.ok ? validation.errors : {};
  const errorSummary = errorSummaryOf(errors);
  const dirty = draft !== savedDraft;

  const save = useMutation({
    mutationFn: (input: QuestionSet) => saveQuestionSet(setId, input),
    // 一覧の名前・問題の数・並び（更新の新しい順）が変わる
    onSuccess: () => queryClient.invalidateQueries({ queryKey: questionSetsQueryOptions.queryKey }),
  });

  const blocker = useBlocker({ shouldBlockFn: blockNavigation, disabled: !dirty, withResolver: true });

  function handleSave() {
    setShowErrors(true);
    if (!validation.ok) {
      return;
    }
    // 保存のあいだに打った分は、保存していない変更として残す
    const sent = draft;
    save.mutate(validation.input, { onSuccess: () => setSavedDraft(sent) });
  }

  return (
    <>
      <main className="mx-auto max-w-4xl px-5 pt-6 pb-32">
        <Link to="/admin" className="font-bold underline focus-visible:outline-2 focus-visible:outline-ring">
          問題セットの一覧に戻る
        </Link>
        <h1 className="mt-6 text-title font-bold">問題セットの編集</h1>

        <Field label="問題セットの名前" error={errors.title} className="mt-cluster">
          {/* 一覧やホストの画面に出る名前なので、問題の入力欄より大きく太く出す */}
          <Input
            value={draft.title}
            onChange={(event) => dispatch({ type: 'setTitle', title: event.target.value })}
            className="text-heading font-bold"
          />
        </Field>

        <ol className="mt-10 grid grid-cols-1 gap-6">
          {draft.questions.map((question, index) => (
            <QuestionEditor
              key={question.key}
              question={question}
              index={index}
              count={draft.questions.length}
              errors={errors}
              dispatch={dispatch}
            />
          ))}
        </ol>

        {draft.questions.length < MAX_QUESTIONS ? (
          // 破線: まだない問題の置き場所に見せる
          <Button
            variant="outline"
            onClick={() => dispatch({ type: 'addQuestion', key: newQuestionKey() })}
            className="mt-6 w-full border-dashed"
          >
            問題を足す
          </Button>
        ) : (
          <p className="mt-6 text-center text-note text-muted-foreground">問題は{MAX_QUESTIONS}問までです</p>
        )}
      </main>

      {/* 保存の帯。長い問題セットでも、どこからでも押せるよう画面の下に固定する */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-end gap-x-4 gap-y-2 px-5 py-3">
          {blocker.status === 'blocked' ? (
            // 押し間違えても書いた内容が消えない「編集に戻る」に、初めからフォーカスする
            <ConfirmDialog
              title="保存していない変更があります"
              detail="このまま離れると、書いた内容は消えます。"
              confirmLabel="保存せずに離れる"
              cancelLabel="編集に戻る"
              onConfirm={blocker.proceed}
              onCancel={blocker.reset}
              className="w-full"
            />
          ) : (
            <>
              <SaveStatus errorSummary={errorSummary} save={save} dirty={dirty} />
              <Button onClick={handleSave} disabled={save.isPending}>
                保存する
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

interface SaveStatusProps {
  errorSummary: string | null;
  save: { isPending: boolean; isSuccess: boolean; error: Error | null };
  dirty: boolean;
}

/** 保存の帯の左に出す、いまの状態。直すところ・保存の失敗・保存中・保存済みの順に1つだけ出す */
function SaveStatus({ errorSummary, save, dirty }: SaveStatusProps) {
  if (errorSummary !== null) {
    return (
      <p role="alert" className="text-body font-bold text-destructive">
        {errorSummary}
      </p>
    );
  }
  if (save.isPending) {
    return (
      <p role="status" className="text-note text-muted-foreground">
        保存しています…
      </p>
    );
  }
  if (save.error !== null) {
    return <SaveError error={save.error} />;
  }
  if (dirty) {
    return <p className="text-note text-muted-foreground">保存していない変更があります</p>;
  }
  if (save.isSuccess) {
    return (
      <p role="status" className="text-note font-bold">
        保存しました
      </p>
    );
  }
  return null;
}

function SaveError({ error }: { error: Error }) {
  if (error instanceof ApiError && error.status === 401) {
    // この画面でログインし直すと、GitHub へ移るあいだに下書きが消える。別のタブでログインすれば Cookie が共有される
    return (
      <p role="alert" className="text-body font-bold text-destructive">
        ログインが切れました。
        <a href="/login" target="_blank" rel="noopener" className="underline">
          別のタブでログインし直して
        </a>
        から、もう一度保存してください。
      </p>
    );
  }
  if (error instanceof ApiError && error.status === 404) {
    return (
      <p role="alert" className="text-body font-bold text-destructive">
        この問題セットは消されているため、保存できません。
      </p>
    );
  }
  return (
    <p role="alert" className="text-body font-bold text-destructive">
      保存できませんでした。もう一度押してください。
    </p>
  );
}
