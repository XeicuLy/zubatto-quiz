import { createFileRoute } from '@tanstack/react-router';

import { questionSetsQueryOptions } from '../../features/admin/api';
import { QuestionSetList } from '../../features/admin/QuestionSetList';

/** 問題セットの一覧（F7）。読めなかったときは、一覧の部品がその理由を出す */
export const Route = createFileRoute('/admin/')({
  // 先に読んでおく。失敗は捨てる。ログインが切れた（401）などは、エラーの画面ではなく一覧の中で知らせる
  loader: async ({ context }) => {
    await context.queryClient.query(questionSetsQueryOptions).catch(() => undefined);
  },
  component: QuestionSetList,
});
