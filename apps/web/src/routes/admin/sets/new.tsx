import { createFileRoute } from '@tanstack/react-router';

import { QuestionSetEditor } from '@/features/admin/QuestionSetEditor';
import { pageTitle } from '@/lib/page-title';

/**
 * 問題セットを作る（F4・F7）。一覧の「問題セットを作る」が、ここへ移る。
 * サーバーは空のセットを受け付けないので、何も読まず、空の下書きから始めて最初の保存で作る。
 * 保存しないで離れたら、何も残らない。静的な経路なので、/admin/sets/$setId より先に一致する
 */
export const Route = createFileRoute('/admin/sets/new')({
  head: () => pageTitle('問題セットを作る'),
  component: NewQuestionSetPage,
});

function NewQuestionSetPage() {
  return <QuestionSetEditor initial={undefined} />;
}
