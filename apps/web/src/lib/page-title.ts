/** サービスの名前。index.html の <title> と同じにする。どのルートも名前を付けない画面（トップ・知らない URL）は、これだけを出す */
export const APP_NAME = 'ズバクイ';

/**
 * ルートの head に渡す、タブのタイトル「<画面名> | ズバクイ」。
 * SPA の画面遷移ではページが読み込み直されないので、スクリーンリーダーはこのタイトルで画面が替わったことを知る。
 * 部屋の ID・参加者の名前・問題セットの名前は入れない（S3）。タブの名前は画面共有や履歴に残る
 */
export function pageTitle(screenName: string) {
  return { meta: [{ title: `${screenName} | ${APP_NAME}` }] };
}
