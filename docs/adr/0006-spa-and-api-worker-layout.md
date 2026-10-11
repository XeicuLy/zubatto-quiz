# 画面の Worker と API の Worker に分け、画面の Worker が `/api/*` を Service binding で API の Worker へ転送して、ブラウザからは同じオリジンにする

## Status

accepted

## Context

ADR 0003 では、SPA と API を同じ Worker に置いても、別の Worker に分けても、W1（Cookie で確かめる WebSocket の入口）が成り立つことだけを確かめ、どちらの構成にするかは決めなかった。構成によって、Cookie の SameSite（T3）、apps/ の構成と wrangler.jsonc（T11）、Better Auth の設定（T13）、CSP の付け方（T24）が変わるので、ここで決める。

画面は React の SPA で作り、API は Hono と部屋の Durable Object で作る（ADR 0001）。この ADR を書いたときは、画面を TanStack Start の SPA モードで作る予定だったが、T24 で TanStack Router だけを使うことにした（「構成とファイルの置き場所」を見る）。ドメインは `*.workers.dev` を使い、買わない（ADR 0003）。忘年会のあとに、API だけを Go + Cloud Run へ置き換える（ADR 0001）。前例の sprout-app は、画面と API を別の Worker に分け、`crossSubDomainCookies` で `.<account>.workers.dev` 全体に Cookie を配っている。ただし sprout-app は SSR なので、画面の Worker もサーバー側で Cookie を読み、API へ転送する必要があった。ズバクイは SPA なので、画面の側にサーバーのコードはなく、Cookie を使うのは API だけである。

各サービスの仕様は、2026-10-11 時点の公式ドキュメント（context7 経由）と、sprout-app のコードで確かめた。

## Decision Drivers

- DD1 セキュリティ（S1、ADR 0003・0004）: ホストのログイン Cookie が、このアプリ以外の Worker に送られない / Cookie を付けた要求を CORS で許す相手がいない（いても最小限） / WebSocket の入口で許す `Origin` を、環境ごとに設定しなくて済む / CSP の `script-src 'self'` を、SPA のすべての画面に確実に付けられる
- DD2 ロックイン耐性（ADR 0001 の D5・D6）: API だけを Go + Cloud Run へ移すときに、画面のコード（API と WebSocket の URL、`credentials`）を変えずに済む。ブラウザがサードパーティ Cookie を送らなくても動く
- DD3 運用・ランニングコスト（C1〜C3）: Workers Free のまま使える。静的ファイルの配信で、1日10万リクエストの枠を使わない。ドメインを買わない
- DD4 変更容易性・開発の手間（M1、ADR 0005）: ローカルで画面と API が1つのコマンドで動く。デプロイの手順と、環境ごとの設定（相手の URL など）が少ない。vitest-plugin で API と DO をテストできる
- DD5 学習コスト・期限（ADR 0001 の40〜80時間）: 公式の手順から外れる量と、sprout-app の作りを使い回せる量

## Considered Options

- L1. 同じ Worker: 1つの Worker に SPA のビルドを静的アセットとして載せ、`run_worker_first: ['/api/*']` で `/api/*` だけを Worker のコードに通す。Worker の入口は `/api/*` を Hono に渡し、部屋の DO も export する
- L2. 別の Worker（sprout-app と同じ形）: 画面の Worker と API の Worker に分ける。Better Auth の `crossSubDomainCookies`（`.<account>.workers.dev`）、Cookie を送る CORS、`trustedOrigins`、WebSocket の `Origin` の許可リストを、環境ごとに設定する
- L3. 別の Worker を Service binding でつなぐ: 画面の Worker と API の Worker に分け、画面の Worker が `/api/*` を Service binding で API の Worker へ転送する。ブラウザからは同じオリジンに見える

## Decision Outcome

採用する選択肢: 「L3（画面の Worker が `/api/*` を Service binding で API の Worker へ転送する）」。

理由:

- L3 は、DD1 と DD3 で L1 と同じくらい良く、DD2 と DD4 の一部で L1 を上回る
  - ブラウザからは同じオリジンなので、CORS も `crossSubDomainCookies` も要らない。ログイン Cookie は画面の Worker のホストにだけ届く（DD1）
  - 転送された要求の URL は画面の Worker のものなので、WebSocket の入口は `Origin` を `new URL(request.url).origin` と比べればよく、環境ごとの許可リストが要らない（DD1）
  - 画面を開く要求は静的アセットが返すので、CSP を `_headers` で付けられる。`_headers` は Worker のコードが返す応答には付かないが、`run_worker_first` を配列で指定すると、指定した経路だけが Worker を通る（DD1）
  - 静的アセットの配信は無料で、回数の上限もない。Service binding 経由の要求は追加のリクエストとして数えず、2つの Worker の CPU 時間の合計だけが数えられる（DD3）
  - すでに「前段の Worker が後ろのサービスへ転送する」形になっているので、Go へ移すときは、転送先を Service binding から Cloud Run への `fetch` に替えるだけで済む。画面は相対 URL（`/api/...`）だけを使うので、画面のコードは変わらない（DD2）
  - 画面の Worker だけをデプロイしても、部屋の DO の WebSocket は切れない。本番中に画面だけを直せる（DD4）
  - apps/web と apps/api がパッケージで分かれるので、vitest-plugin の設定は API だけで済み、画面から API のコードを import できない境目も自然にできる（DD4）
  - Cloudflare の Vite プラグインの `auxiliaryWorkers` で、`vite dev` 1つで2つの Worker と DO を動かせる。公式もこの形を勧めている（DD4）
- L1 は、設定とデプロイが最も少ないが、選ばなかった
  - どのデプロイでも部屋の DO の WebSocket が切れるので、本番中に画面だけを直すことができない
  - 1つのパッケージに、ブラウザのコードと Worker のコードが混ざる。vitest を2つの環境で動かし、テストでは TanStack Start の入口を通さない `main` を用意する必要がある
  - Go へ移すときに、転送のコードを新しく足すか、画面も Cloud Run に載せることになる
- L2 は、DD2 を満たさないため除外した
  - API を `*.run.app` に移すと、`workers.dev` とは別のサイトになる。ログイン Cookie はサードパーティ Cookie になり、Safari などでは送られない。結局、転送かドメインの購入が要り、今 Worker を分けておくことが移行の助けにならない
  - `crossSubDomainCookies` で `.<account>.workers.dev` 全体に Cookie を配ると、同じアカウントのほかの Worker にもログイン Cookie が届く（DD1）
  - Cookie を付けた CORS、`trustedOrigins`、`Origin` の許可リストを環境ごとに持つ必要がある（DD1・DD4）
  - sprout-app で別の Worker にしたのは SSR のためで、SPA のズバクイには当てはまらない

### 構成とファイルの置き場所

```text
apps/web/   画面の Worker（TanStack Router の SPA と、/api/* の転送）
  wrangler.jsonc   assets（not_found_handling: single-page-application、run_worker_first: ['/api/*']）と、API の Worker への services の binding
  index.html       SPA の入口。インラインのスクリプトを置かない
  src/server.ts    Worker の入口。/api/* だけを env.API.fetch(request) へ転送する。ほかの経路は静的アセットが返すので、ここには来ない
  public/_headers  CSP
apps/api/   API の Worker（Hono・部屋の DO・Better Auth）
  wrangler.jsonc   workers_dev: false、preview_urls: false、DO と D1 の binding
```

決めた構成での、T11・T13・T24 の変更ファイルのパス:

| Issue      | パスと変わる点                                                                                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T11（#15） | Issue のパス（`apps/api/...`）のまま。`apps/api/wrangler.jsonc` に `workers_dev: false` と `preview_urls: false` を書く。CORS のミドルウェアは作らない                                                                                                                                   |
| T13（#17） | Issue のパス（`apps/api/src/auth/...`）のまま。`crossSubDomainCookies` と CORS は設定しない。`baseURL` は画面の Worker の URL にし、GitHub のコールバック URL も画面の Worker の `/api/auth/callback/github` にする                                                                      |
| T24（#28） | Issue のパス（`apps/web/...`）に加えて、`apps/web/wrangler.jsonc`、`apps/web/src/server.ts`、`apps/web/worker-configuration.d.ts` を作る。`apps/web/vite.config.ts` の `auxiliaryWorkers` に `../api/wrangler.jsonc` を指定する。CSP は Issue のとおり `apps/web/public/_headers` に書く |

## Consequences

- 良い影響: ブラウザからは同じオリジンなので、CORS と `crossSubDomainCookies` が要らず、ログイン Cookie が画面の Worker のホストにだけ届く
- 良い影響: 画面だけを直すときは、画面の Worker だけをデプロイでき、本番中でも部屋の WebSocket が切れない
- 良い影響: Go + Cloud Run へ移すときは、画面の Worker の転送先を替えるだけで、画面のコードは変わらない（ADR 0001 の D5・D6）
- 悪い影響: Worker と wrangler.jsonc が2つになる。デプロイは、API の Worker を先にし、画面の Worker をあとにする（Service binding の相手が先にないといけないため）
- 悪い影響: API の Worker の workers.dev の URL を閉じ忘れると、画面の Worker を通らずに API を直接呼べてしまう
- 悪い影響: 画面の Worker に、転送のための Worker のコードが要る
- 悪い影響: 止めるときは、2つの Worker を削除する。API の Worker を消せば、DO と D1 の利用は止まる
- 対応事項: API と WebSocket の経路は、すべて `/api/` の下に置く。Better Auth の `basePath` も `/api/auth` にする
- 対応事項: ホスト用・回答者用の WebSocket の入口では、`Origin` を `new URL(request.url).origin`（画面の Worker のオリジン）と比べる（T18）
- 対応事項（T24 で対応済み）: Service binding で WebSocket の Upgrade が通ることを、T24 で転送を作るときに確かめる。通らなければ、この ADR を見直す
  - 2026-10-11 に `vite dev`（`auxiliaryWorkers`）で、画面の Worker 経由で API の Worker の WebSocket につなぎ、送った文字が返ってくることを確かめた。`Cookie` と `Origin` も、転送のあとにそのまま API の Worker に届いた。本番での確認は T35 で行う
- 対応事項（T24 で対応済み）: SPA の shell を `index.html` として出す。`not_found_handling: 'single-page-application'` が返すのは `/index.html` のため
  - TanStack Start の SPA モードは、`spa.prerender.outputPath` で shell を `index.html` に出せる。ただし shell には hydration 用のインラインのスクリプトが2つ入り、中身にビルドの時刻が入るのでビルドごとに変わる。クライアントはこのスクリプトが作る `window.$_TSR` がないと起動しないので、CSP の `script-src 'self'`（ADR 0004）と両立しない（2026-10-11 に TanStack Start 1.168.61 のビルドで確かめた）
  - hash を CSP に足す方法と、ビルドのあとにスクリプトを外部ファイルへ出す方法も比べたが、どちらもビルドの手順が増え、後者は TanStack の内部の出力の形に頼る。画面はサーバーの機能（SSR やサーバー関数）を使わないので、TanStack Start をやめ、Vite の `index.html` を入口にして TanStack Router だけを使うことにした。`index.html` にインラインのスクリプトはなく、CSP は `script-src 'self'` のままでよい
- 対応事項（T24 で対応済み）: CSP の `connect-src 'self'` で WebSocket もつなげるかを、T24 で確かめる
  - 2026-10-11 に `vite build` と `vite preview`（`_headers` の CSP が付く）で、同じオリジンの `ws:` にはつながり、ほかのホストへの `wss:` は CSP で止まることを、Chromium で確かめた。`connect-src` には `wss:` を足さない
- 対応事項: GitHub OAuth App のローカル用のコールバック URL は、`vite dev` のオリジンにする。README の停止手順は「2つの Worker を削除する」にする（T34）
- 対応事項: 本番中は API の Worker をデプロイしない（部屋の DO の WebSocket が切れるため）。画面の Worker だけなら切れない
- 対応事項: Go + Cloud Run への置き換えの ADR で、画面の Worker から Cloud Run へ転送する（WebSocket を含む）か、画面も Cloud Run に載せるかを決める。Cloud Run の URL を直接呼ばれないようにする方法もあわせて決める
