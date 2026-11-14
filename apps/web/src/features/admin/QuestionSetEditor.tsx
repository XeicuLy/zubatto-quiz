import { Link } from '@tanstack/react-router';
import { MAX_QUESTIONS, type QuestionSetDetail } from '@zubatto-quiz/protocol';
import { useReducer, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input } from '@/components/ui/field';
import { ActionError, LoginLink } from '@/shared/feedback/ActionError';

import { draftOf, editorReducer, errorSummaryOf, newQuestionKey, validateDraft } from './question-set-draft';
import { QuestionEditor } from './QuestionEditor';
import { type SaveIntent, useQuestionSetSave } from './use-question-set-save';

interface QuestionSetEditorProps {
  setId: string;
  /** 開いたときに読んだ問題セット。下書きは、これから1回だけ作る */
  initial: QuestionSetDetail;
}

/**
 * 問題セットの編集（F4・F7・F9）。下書きは画面の中だけで持ち、「保存する」か「保存して一覧へ」で丸ごと PUT する。
 * 2つの違いは、保存できたあとに一覧へ移るかどうかだけ。保存の流れと離れる前の確かめは useQuestionSetSave が持つ。
 *
 * 誤りは、初めて保存を押したときに出し、以後は直すたびに出し直す。打ち始めから赤くしないため。
 * 保存していない変更があるうちは、画面を離れる前に確かめる（経路の移動とタブを閉じる操作の両方）。
 * 管理画面の中の移動は、保存の帯の中身を ConfirmDialog に入れ替えて確かめる。画面を覆わないので、書いた内容を見ながら選べる
 */
export function QuestionSetEditor({ setId, initial }: QuestionSetEditorProps) {
  const [draft, dispatch] = useReducer(editorReducer, initial, draftOf);
  const [showErrors, setShowErrors] = useState(false);
  const { save, dirty, blocker, isPending, error } = useQuestionSetSave({ setId, draft });

  const validation = validateDraft(draft);
  const errors = showErrors && !validation.ok ? validation.errors : {};
  const errorSummary = errorSummaryOf(errors);

  function handleSave(intent: SaveIntent) {
    setShowErrors(true);
    // 誤りがあれば、どちらのボタンでも送らず、移らない
    if (!validation.ok) {
      return;
    }
    save(validation.input, intent);
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
              <SaveStatus errorSummary={errorSummary} isPending={isPending} error={error} dirty={dirty} />
              {/* 書き終えて一覧で部屋を作る流れが本筋なので、「保存して一覧へ」を主にする。「保存する」は書く途中の保存 */}
              <Button variant="outline" onClick={() => handleSave('stay')} disabled={isPending}>
                保存する
              </Button>
              <Button onClick={() => handleSave('list')} disabled={isPending}>
                保存して一覧へ
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
  isPending: boolean;
  error: Error | null;
  dirty: boolean;
}

/**
 * 保存の帯の左に出す、いまの状態。直すところ・保存中・保存の失敗・保存していない変更の順に1つだけ出す。
 * 保存できたことは toast（notify）が知らせるので、ここには出さない。出すと2回読まれる
 */
function SaveStatus({ errorSummary, isPending, error, dirty }: SaveStatusProps) {
  if (errorSummary !== null) {
    return (
      <p role="alert" className="text-body font-bold text-destructive">
        {errorSummary}
      </p>
    );
  }
  if (isPending) {
    return (
      <p role="status" className="text-note text-muted-foreground">
        保存しています…
      </p>
    );
  }
  if (error !== null) {
    return (
      <ActionError
        error={error}
        failed="保存できませんでした。もう一度押してください。"
        // この画面でログインし直すと、GitHub へ移るあいだに下書きが消える。別のタブでログインすれば Cookie が共有される
        unauthorized={
          <>
            ログインが切れました。<LoginLink newTab>別のタブでログインし直して</LoginLink>
            から、もう一度保存してください。
          </>
        }
        notFound="この問題セットは消されているため、保存できません。"
      />
    );
  }
  if (dirty) {
    return <p className="text-note text-muted-foreground">保存していない変更があります</p>;
  }
  return null;
}
