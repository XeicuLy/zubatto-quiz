import { Link } from '@tanstack/react-router';

export function NotFoundScreen() {
  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="text-xl font-bold">ページが見つかりません</h1>
      <p className="mt-4 text-backstage-muted">URL が正しいか確かめてください。</p>
      <Link to="/" className="mt-8 inline-block font-bold underline">
        トップへ戻る
      </Link>
    </main>
  );
}
