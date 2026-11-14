import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { QuestionSetSummary } from '@zubatto-quiz/protocol';
import { useRef } from 'react';

import { deleteQuestionSet, questionSetsQueryOptions } from '@/api/question-sets';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';
import { ActionError } from '@/shared/feedback/ActionError';
import { describeApiError } from '@/shared/feedback/api-error';
import { LoadErrorCard } from '@/shared/feedback/LoadErrorCard';
import { notify } from '@/shared/feedback/notify';

import { CreateRoomButton } from './CreateRoomButton';

/** 更新した日。ホストは日本にいるので、端末の時刻の設定によらず日本の時刻で出す */
const updatedDate = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' });

/**
 * 自分の問題セットの一覧（F1・F7）。作る・部屋を作る・編集へ移る・消すができる
 */
export function QuestionSetList() {
  const sets = useQuery(questionSetsQueryOptions);

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-title font-bold">問題セット</h1>
        {sets.data !== undefined && sets.data.length > 0 && <CreateLink />}
      </div>
      <p className="mt-3 text-note text-muted-foreground">
        部屋は、作った時点の問題セットを使います。部屋を作ったあとに編集しても、その部屋には反映されません。
      </p>

      {sets.isPending ? (
        <p className="mt-8 text-muted-foreground">読み込んでいます…</p>
      ) : sets.isError ? (
        <LoadErrorCard
          error={sets.error}
          failed="問題セットを読めませんでした"
          retry={() => void sets.refetch()}
          titleAs="p"
          className="mt-8"
        />
      ) : sets.data.length === 0 ? (
        <div className="mt-8 rounded-panel border-2 border-dashed border-border p-10 text-center">
          <p className="text-heading font-bold">まだ問題セットがありません</p>
          <p className="mt-2 text-muted-foreground">問題セットを作ると、そこから部屋を作れます。</p>
          <div className="mt-6">
            <CreateLink />
          </div>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-border rounded-panel border border-border bg-card">
          {sets.data.map((set) => (
            <QuestionSetRow key={set.id} set={set} />
          ))}
        </ul>
      )}
    </main>
  );
}

/**
 * 空の作成画面（/admin/sets/new）へ移る。何も保存しないので、作らずに離れても一覧に何も増えない。
 * サーバーは空のセットを受け付けないので、作るのは作成画面で最初に保存したとき
 */
function CreateLink() {
  return (
    <Link to="/admin/sets/new" className={buttonVariants()}>
      問題セットを作る
    </Link>
  );
}

function QuestionSetRow({ set }: { set: QuestionSetSummary }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm<'delete'>();
  const deleteButton = useRef<HTMLButtonElement>(null);
  const remove = useMutation({
    mutationFn: () => deleteQuestionSet(set.id),
    // 行ごと消えるので、行の中では知らせられない。画面の隅に出す
    onSuccess: () => notify(`「${set.title}」を消しました`),
    // 失敗しても読み直す。別のタブで先に消していた（404）なら、一覧から消える（知らせは出さない）
    onSettled: () => queryClient.invalidateQueries({ queryKey: questionSetsQueryOptions.queryKey }),
  });

  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
      <div className="min-w-0 flex-1 basis-56">
        <h2 className="text-heading font-bold wrap-anywhere">{set.title}</h2>
        <p className="mt-1 text-note text-muted-foreground">
          {set.questionCount}問 / {updatedDate.format(new Date(set.updatedAt))}に更新
        </p>
      </div>
      {confirm.confirming === 'delete' ? (
        // 消すと部屋も止まるかと迷わないよう、作った部屋は問題セットを写して持つので残ることを添える
        <ConfirmDialog
          title="本当に消しますか？"
          detail="消した問題セットは戻せません。作ってある部屋は、そのまま使えます。"
          confirmLabel="本当に消す"
          onConfirm={() => remove.mutate()}
          onCancel={confirm.close}
          size="sm"
          pending={remove.isPending}
          className="w-full"
        />
      ) : (
        // min-w-0: 「部屋を作る」の失敗の知らせ（w-full）が出たら、行の幅まで縮んで文を折り返す。shrink-0 だと文が1行に伸びてはみ出す
        <div className="flex min-w-0 flex-wrap gap-2">
          <CreateRoomButton questionSetId={set.id} />
          <Link
            to="/admin/sets/$setId"
            params={{ setId: set.id }}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            編集
          </Link>
          <Button
            ref={deleteButton}
            variant="link"
            size="sm"
            onClick={() => confirm.open('delete', deleteButton)}
            className="text-destructive"
          >
            消す
          </Button>
        </div>
      )}
      {remove.isError && describeApiError(remove.error) !== 'notFound' && (
        <ActionError error={remove.error} failed="消せませんでした。もう一度押してください。" className="w-full" />
      )}
    </li>
  );
}
