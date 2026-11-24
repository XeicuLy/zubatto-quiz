/** サービスの名前。index.html の <title> と同じにする */
export const APP_NAME = 'ズバクイ';

/**
 * ルートの head に渡す、タブのタイトル「<画面名> | ズバクイ」。
 * SPA の画面遷移ではページが読み込み直されないので、スクリーンリーダーはこのタイトルで画面が替わったことを知る。
 * 部屋の ID・参加者の名前・問題セットの名前は入れない（S3）。タブの名前は画面共有や履歴に残る
 */
export function pageTitle(screenName: string) {
  return { meta: [{ title: `${screenName} | ${APP_NAME}` }] };
}

/**
 * notFound() を投げる経路の head に渡す。経路には合っていても中身が 404 の画面のときは、タイトルを付けず、
 * __root の「ページが見つかりません」を残す。TanStack Router は、beforeLoad で notFound() を投げた経路の head も呼ぶので、
 * 何もしないと 404 の画面に「クイズに参加」のような経路のタイトルが付く
 */
export function pageTitleUnlessNotFound(screenName: string) {
  // 引数の型を書いておく。head の引数を文脈から推論させると、loader の型と循環して loaderData が never になる
  return ({ match }: { match: { status: string } }) => (match.status === 'notFound' ? {} : pageTitle(screenName));
}
