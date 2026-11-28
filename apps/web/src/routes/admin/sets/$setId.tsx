import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';

import { questionSetQueryOptions } from '@/api/question-sets';
import { QuestionSetEditor } from '@/features/admin/QuestionSetEditor';
import { pageTitle } from '@/lib/page-title';
import { LoadErrorCard } from '@/shared/feedback/LoadErrorCard';

/**
 * 問題セットの編集（F4・F7）。一覧の「編集」と、新しい問題セットを初めて保存したとき（/admin/sets/new）が、ここへ移る。
 * 開くたびに読み直し、読めてから編集の画面を出す。下書きは読んだ値から1回だけ作る。
 * gcTime: 0 で、離れた match を Router に残さない。残すと、開き直したときに古い loaderData で先に画面を出し、
 * 読み直しは裏で行う。下書きはそのあと届いた値を拾わないので、保存する前の内容から編集を始めてしまう。
 * loader は、離れる前に始めた同じセットの取得が残っていれば、取り消してから読む。query() はそれに合流するので、
 * そのあいだに別のタブで保存した分を拾えない（gcTime: 0 で消えるのは Router の match だけで、Query の取得は止まらない）
 */
export const Route = createFileRoute('/admin/sets/$setId')({
  head: () => pageTitle('問題セットの編集'),
  loader: async ({ context, params }) => {
    const options = questionSetQueryOptions(params.setId);
    await context.queryClient.cancelQueries({ queryKey: options.queryKey, exact: true });
    return context.queryClient.query(options);
  },
  gcTime: 0,
  errorComponent: QuestionSetLoadError,
  component: QuestionSetEditPage,
});

function QuestionSetEditPage() {
  const { setId } = Route.useParams();
  // key で、別のセットへ移ったときに下書きを作り直す
  return <QuestionSetEditor key={setId} initial={Route.useLoaderData()} />;
}

function QuestionSetLoadError({ error }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <LoadErrorCard
        error={error}
        failed="問題セットを読めませんでした"
        retry={() => void router.invalidate()}
        // 他人のセットも、ないセットと同じに見せる（S1）
        notFound={{
          title: '問題セットが見つかりません',
          detail: '消されたか、URL が違います。',
          back: { to: '/admin', label: '問題セットの一覧に戻る' },
        }}
        titleAs="h1"
      />
    </main>
  );
}
