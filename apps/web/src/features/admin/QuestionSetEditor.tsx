import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker } from '@tanstack/react-router';
import { MAX_QUESTIONS, type QuestionSet, type QuestionSetDetail } from '@zubatto-quiz/protocol';
import { useId, useLayoutEffect, useReducer, useRef, useState } from 'react';

import { ApiError, questionSetsQueryOptions, saveQuestionSet } from './api';
import { draftOf, editorReducer, errorSummaryOf, newQuestionKey, validateDraft } from './question-set-draft';
import { QuestionEditor } from './QuestionEditor';

interface QuestionSetEditorProps {
  setId: string;
  /** 開いたときに読んだ問題セット。下書きは、これから1回だけ作る */
  initial: QuestionSetDetail;
}

const focusRing = 'focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-stage';

/** 離れるのを止めるかどうかは disabled で切り替える。関数は描くたびに作り直さない（作り直すと登録し直しになる） */
const blockNavigation = () => true;

/**
 * 問題セットの編集（F4・F7・F9）。下書きは画面の中だけで持ち、「保存する」で丸ごと PUT する。
 *
 * 誤りは、初めて「保存する」を押したときに出し、以後は直すたびに出し直す。打ち始めから赤くしないため。
 * 保存していない変更があるうちは、画面を離れる前に確かめる（経路の移動とタブを閉じる操作の両方）
 */
export function QuestionSetEditor({ setId, initial }: QuestionSetEditorProps) {
  const id = useId();
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

  const titleError = errors.title;

  return (
    <>
      <main className="mx-auto max-w-4xl px-5 pt-6 pb-32">
        <Link to="/admin" className="font-bold underline focus-visible:outline-2 focus-visible:outline-stage">
          問題セットの一覧に戻る
        </Link>
        <h1 className="mt-6 text-3xl font-bold">問題セットの編集</h1>

        <label htmlFor={`${id}-title`} className="mt-8 block text-sm font-bold text-backstage-muted">
          問題セットの名前
        </label>
        <input
          id={`${id}-title`}
          value={draft.title}
          onChange={(event) => dispatch({ type: 'setTitle', title: event.target.value })}
          aria-invalid={titleError !== undefined}
          aria-describedby={titleError === undefined ? undefined : `${id}-title-error`}
          className="mt-2 w-full rounded-chip border-2 border-backstage-line bg-backstage-surface px-4 py-3 text-2xl font-bold focus-visible:border-stage focus-visible:outline-none aria-invalid:border-alert-strong"
        />
        {titleError !== undefined && (
          <p id={`${id}-title-error`} className="mt-2 text-sm font-bold text-alert-strong">
            {titleError}
          </p>
        )}

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
          <button
            type="button"
            onClick={() => dispatch({ type: 'addQuestion', key: newQuestionKey() })}
            className={`mt-6 w-full rounded-panel border-2 border-dashed border-backstage-line py-4 font-bold ${focusRing}`}
          >
            問題を足す
          </button>
        ) : (
          <p className="mt-6 text-center text-sm text-backstage-muted">問題は{MAX_QUESTIONS}問までです</p>
        )}
      </main>

      {/* 保存の帯。長い問題セットでも、どこからでも押せるよう画面の下に固定する */}
      <div className="fixed inset-x-0 bottom-0 border-t border-backstage-line bg-backstage-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-end gap-x-4 gap-y-2 px-5 py-3">
          <SaveStatus errorSummary={errorSummary} save={save} dirty={dirty} />
          <button
            type="button"
            onClick={handleSave}
            disabled={save.isPending}
            className={`rounded-full bg-stage px-6 py-2.5 font-bold text-on-stage disabled:opacity-60 ${focusRing}`}
          >
            保存する
          </button>
        </div>
      </div>

      {blocker.status === 'blocked' && <LeaveDialog onStay={blocker.reset} onLeave={blocker.proceed} />}
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
      <p role="alert" className="text-sm font-bold text-alert-strong">
        {errorSummary}
      </p>
    );
  }
  if (save.isPending) {
    return (
      <p role="status" className="text-sm text-backstage-muted">
        保存しています…
      </p>
    );
  }
  if (save.error !== null) {
    return <SaveError error={save.error} />;
  }
  if (dirty) {
    return <p className="text-sm text-backstage-muted">保存していない変更があります</p>;
  }
  if (save.isSuccess) {
    return (
      <p role="status" className="text-sm font-bold">
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
      <p role="alert" className="text-sm font-bold text-alert-strong">
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
      <p role="alert" className="text-sm font-bold text-alert-strong">
        この問題セットは消されているため、保存できません。
      </p>
    );
  }
  return (
    <p role="alert" className="text-sm font-bold text-alert-strong">
      保存できませんでした。もう一度押してください。
    </p>
  );
}

/**
 * 保存していない変更があるまま、管理画面の中を移ろうとしたときの確かめ。
 * 開いたら「編集に戻る」にフォーカスし、押し間違えても書いた内容が消えない方に合わせる。
 * autoFocus は jsx-a11y の no-autofocus に当たるので、ref で動かす
 */
function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const id = useId();
  const stayButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    stayButton.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-backstage-ink/40 px-5">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-heading`}
        aria-describedby={`${id}-body`}
        className="w-full max-w-md rounded-panel bg-backstage-surface p-6 shadow-lg"
      >
        <h2 id={`${id}-heading`} className="text-lg font-bold">
          保存していない変更があります
        </h2>
        <p id={`${id}-body`} className="mt-2 text-sm leading-relaxed text-backstage-muted">
          このまま離れると、書いた内容は消えます。
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onLeave}
            className="rounded-full px-4 py-2 text-sm font-bold text-alert-strong underline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-stage"
          >
            保存せずに離れる
          </button>
          <button
            ref={stayButton}
            type="button"
            onClick={onStay}
            className="rounded-full bg-stage px-5 py-2 text-sm font-bold text-on-stage focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-stage"
          >
            編集に戻る
          </button>
        </div>
      </div>
    </div>
  );
}
