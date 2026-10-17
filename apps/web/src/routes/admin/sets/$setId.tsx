import { createFileRoute, Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';

import { ApiError, questionSetQueryOptions } from '../../../features/admin/api';
import { QuestionSetEditor } from '../../../features/admin/QuestionSetEditor';

/**
 * 問題セットの編集（F4・F7）。一覧の「問題セットを作る」と「編集」が、ここへ移る。
 * 開くたびに読み直し、読めてから編集の画面を出す。下書きは読んだ値から1回だけ作る
 */
export const Route = createFileRoute('/admin/sets/$setId')({
  loader: ({ context, params }) => context.queryClient.query(questionSetQueryOptions(params.setId)),
  errorComponent: QuestionSetLoadError,
  component: QuestionSetEditPage,
});

function QuestionSetEditPage() {
  const { setId } = Route.useParams();
  // key で、別のセットへ移ったときに下書きを作り直す
  return <QuestionSetEditor key={setId} setId={setId} initial={Route.useLoaderData()} />;
}

function QuestionSetLoadError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const status = error instanceof ApiError ? error.status : null;

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <div role="alert" className="rounded-panel border-2 border-alert-strong bg-backstage-surface p-5">
        {status === 401 ? (
          <>
            <h1 className="font-bold text-alert-strong">ログインが切れました</h1>
            <Link to="/login" className="mt-3 inline-block font-bold underline">
              ログインし直す
            </Link>
          </>
        ) : status === 404 ? (
          <>
            {/* 他人のセットも、ないセットと同じに見せる（S1） */}
            <h1 className="font-bold text-alert-strong">問題セットが見つかりません</h1>
            <p className="mt-2 text-sm text-backstage-muted">消されたか、URL が違います。</p>
            <Link to="/admin" className="mt-3 inline-block font-bold underline">
              問題セットの一覧に戻る
            </Link>
          </>
        ) : (
          <>
            <h1 className="font-bold text-alert-strong">問題セットを読めませんでした</h1>
            <button type="button" onClick={() => void router.invalidate()} className="mt-3 font-bold underline">
              もう一度読む
            </button>
          </>
        )}
      </div>
    </main>
  );
}
