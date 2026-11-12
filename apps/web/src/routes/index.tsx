import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: TopPage,
});

// 入口のページ（#294）ができるまでの仮のトップ。使い方へのリンクだけを置く
function TopPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="font-logo text-display">ズバクイ</h1>
      <Link to="/guide" className="mt-cluster inline-block font-bold underline underline-offset-4">
        使い方を見る
      </Link>
    </main>
  );
}
