import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { QuestionSetSummary } from '@zubatto-quiz/protocol';
import { useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';

import { CreateRoomButton } from '../host/CreateRoomButton';
import { ApiError, createDraftQuestionSet, deleteQuestionSet, questionSetsQueryOptions } from './api';

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
        <h1 className="text-3xl font-bold">問題セット</h1>
        {sets.data !== undefined && sets.data.length > 0 && <CreateButton align="end" />}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-backstage-muted">
        部屋は、作った時点の問題セットを使います。部屋を作ったあとに編集しても、その部屋には反映されません。
      </p>

      {sets.isPending ? (
        <p className="mt-8 text-backstage-muted">読み込んでいます…</p>
      ) : sets.isError ? (
        <LoadError error={sets.error} retry={() => void sets.refetch()} />
      ) : sets.data.length === 0 ? (
        <div className="mt-8 rounded-panel border-2 border-dashed border-backstage-line p-10 text-center">
          <p className="text-lg font-bold">まだ問題セットがありません</p>
          <p className="mt-2 text-backstage-muted">問題セットを作ると、そこから部屋を作れます。</p>
          <div className="mt-6">
            <CreateButton align="center" />
          </div>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-backstage-line rounded-panel border border-backstage-line bg-backstage-surface">
          {sets.data.map((set) => (
            <QuestionSetRow key={set.id} set={set} />
          ))}
        </ul>
      )}
    </main>
  );
}

/** 見出しの横では右に、空のときの枠の中では真ん中に、ボタンと失敗の知らせを寄せる */
const createButtonAlign = {
  end: 'items-end',
  center: 'items-center',
} as const;

/** 下書きを保存し、その編集画面へ移る。問題セットは1問以上ないと保存できないので、空のままでは作れない */
function CreateButton({ align }: { align: keyof typeof createButtonAlign }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: createDraftQuestionSet,
    onSuccess: async (setId) => {
      // 一覧の読み直しは待たずに移る。一覧へ戻ったときには、新しいセットが入っている
      void queryClient.invalidateQueries({ queryKey: questionSetsQueryOptions.queryKey });
      await navigate({ to: '/admin/sets/$setId', params: { setId } });
    },
  });

  return (
    <div className={`flex flex-col gap-2 ${createButtonAlign[align]}`}>
      <Button onClick={() => create.mutate()} disabled={create.isPending}>
        問題セットを作る
      </Button>
      {create.isError && (
        <p role="alert" className="text-sm font-bold text-alert-strong">
          問題セットを作れませんでした。もう一度押してください。
        </p>
      )}
    </div>
  );
}

function QuestionSetRow({ set }: { set: QuestionSetSummary }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteQuestionSet(set.id),
    // 失敗しても読み直す。別のタブで先に消していた（404）なら、一覧から消える
    onSettled: () => queryClient.invalidateQueries({ queryKey: questionSetsQueryOptions.queryKey }),
  });

  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
      <div className="min-w-0 flex-1 basis-56">
        <h2 className="text-lg font-bold wrap-anywhere">{set.title}</h2>
        <p className="mt-1 text-sm text-backstage-muted">
          {set.questionCount}問 / {updatedDate.format(new Date(set.updatedAt))}に更新
        </p>
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-alert-strong">本当に消しますか？</p>
          <Button variant="destructive" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
            本当に消す
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={remove.isPending}>
            やめる
          </Button>
        </div>
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
          <Button variant="link" size="sm" onClick={() => setConfirming(true)} className="text-destructive">
            消す
          </Button>
        </div>
      )}
      {remove.isError && !(remove.error instanceof ApiError && remove.error.status === 404) && (
        <p role="alert" className="w-full text-sm font-bold text-alert-strong">
          消せませんでした。もう一度押してください。
        </p>
      )}
    </li>
  );
}

function LoadError({ error, retry }: { error: Error; retry: () => void }) {
  if (error instanceof ApiError && error.status === 401) {
    return (
      <div role="alert" className="mt-8 rounded-panel border-2 border-alert-strong bg-backstage-surface p-5">
        <p className="font-bold text-alert-strong">ログインが切れました</p>
        <Link to="/login" className="mt-3 inline-block font-bold underline">
          ログインし直す
        </Link>
      </div>
    );
  }
  return (
    <div role="alert" className="mt-8 rounded-panel border-2 border-alert-strong bg-backstage-surface p-5">
      <p className="font-bold text-alert-strong">問題セットを読めませんでした</p>
      <button type="button" onClick={retry} className="mt-3 font-bold underline">
        もう一度読む
      </button>
    </div>
  );
}
