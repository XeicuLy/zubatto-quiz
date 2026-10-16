import { createFileRoute } from '@tanstack/react-router';

// 問題セットの編集（T30）。一覧の「問題セットを作る」と「編集」が、ここへ移る
export const Route = createFileRoute('/admin/sets/$setId')({
  component: QuestionSetEditPage,
});

function QuestionSetEditPage() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <h1 className="font-display text-3xl">問題セットの編集</h1>
    </main>
  );
}
