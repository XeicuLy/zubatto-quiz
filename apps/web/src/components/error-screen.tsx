export function ErrorScreen() {
  // エラーの中身は出さない。英語のメッセージや内部の情報が画面に出ないようにする（SC3）
  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="text-xl font-bold">エラーが起きました</h1>
      <p className="mt-4 text-backstage-muted">ページを読み込み直してください。</p>
    </main>
  );
}
