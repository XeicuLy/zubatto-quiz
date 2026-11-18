# アクセス解析は Workers Analytics Engine に決まったキーだけを記録し、アプリの外で見る

## Status

accepted

## Context

本番がどれだけ使われているかを知る手段がない。要件にも ADR にも、アクセス解析の記述がない。次の2つを数えたい（親 Issue #364）。

- 画面ごとの PV（ページを開いた回数）
- 部屋の出来事: 部屋の作成、問題セットの作成、参加、ゲームの開始、最終結果への到達、途中の終了、回答の受理

はじめは GTM（Google Tag Manager）を入れることを考えた。しかし、解析の手段によっては、CSP（ADR 0004・0006）、S3（推測できない部屋の URL）、S5（個人情報は名前だけ）、C1（無料枠）のどれかが動く。どれも動かさない手段を選んだ理由を、ここに残す。あとで GTM を足したくなったときに、何を手放すことになるのかを分かるようにするためである。

次のことを 2026-11-18 に確かめた（Cloudflare の文書は context7 経由で、Google の文書は CSP の案内のページで）。

- Workers Analytics Engine の Free プランの上限は、書き込みが 10 万件/日、SQL API の読み取りが 1 万回/日。データは3か月で消える
- 1回の `writeDataPoint` には、blob を 20 個、double を 20 個、index を 1 個まで入れられる。blob の合計は 16 KB まで、index は 96 バイトまで。1回の Worker の呼び出しで書けるのは 250 件まで。`writeDataPoint` はすぐに戻り、`await` するものではない
- 量が多いと、Analytics Engine は index ごとに間引いて保存する。間引いた割合は各行の `_sample_interval` に入るので、件数は `COUNT()` ではなく `SUM(_sample_interval)` で数える
- binding は環境に引き継がれないキーである。`env.e2e` のような環境には、先頭の設定の binding が入らない
- ローカル（miniflare）の `writeDataPoint` は、binding に `remote: true` がなければ何もしない。miniflare の `LocalAnalyticsEngineDataset` は、remote の接続がないときに書き込みを捨てる作りになっている（`wrangler` 4.160.0 の miniflare 5.20261110.0-beta と、`@cloudflare/vite-plugin` 1.68.0 の miniflare 5.20261103.0-beta の両方で、コードを読んで確かめた）
- Service binding 経由の要求は、料金のページでは「追加の料金がかからない」と書かれている。ただし、これは Workers Standard の料金の計算の話で、無料プランの1日の上限をどう数えるかは書かれていない。O2 のリハーサルでは、接続 276 本で Workers のリクエストが 590 件だった（[o2-rehearsal.md](../rehearsal/o2-rehearsal.md#1回の本番あたりの目安)）。無料プランの 10 万件/日には、画面の Worker と API の Worker の両方が数えられる
- 静的アセットへの要求は無料で、回数の上限もない。`run_worker_first` に当たる要求（ここでは `/api/*`）は必ず Worker を通り、無料枠を超えると 429 が返る
- GTM の入口のスクリプトは、インラインの `<script>` である。Google の CSP の案内では、nonce を使うのが推奨で、ほかは hash か `'unsafe-inline'`。さらに `https://www.googletagmanager.com` を許す必要がある。GTM の「カスタム JavaScript 変数」は、`'unsafe-eval'` がないと動かない。GA4 は、`img-src` と `connect-src` に `https://*.google-analytics.com` などの Google のホストを許す必要がある

### 実装の前に確かめたこと

2026-11-18 に、使い捨ての Worker（Worker と DO の両方から `writeDataPoint` を呼ぶもの）を `wrangler dev`（4.160.0）で動かして確かめた。

| 確かめたこと                                                                 | 結果                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env.e2e` に binding を書かないと、`env.ANALYTICS` が `undefined` になるか   | なる。先頭の設定で動かすと、Worker でも DO でも `typeof env.ANALYTICS` は `object`。`--env e2e` で動かすと、どちらも `undefined` だった。ただし wrangler は、起動のたびに「`analytics_engine_datasets` が先頭にあるのに `env.e2e` にない」という WARNING を出す。止まりはしない |
| ローカルの `vite dev` で、Worker と DO の両方の書き込みが捨てられるか        | 捨てられる。上の miniflare のコードのとおりで、DO も Worker と同じ binding を受け取る。`writeDataPoint` を呼んでも、Worker でも DO でも例外は出なかった。`vite dev` も同じ miniflare の作りを使う。そのため、開発の入口（`test/dev-entry.ts`）から binding を外す必要はない     |
| 書き込みが上限を超えたときの動き                                             | 文書には書かれていない。本番の枠を使い切って試すことはしない。そのため、超えたときに `writeDataPoint` が例外を投げても、黙って捨てても、進行が止まらない作りにする（`await` せず、`try/catch` で包む）。超えたかどうかは、ダッシュボードの書き込みの数で確かめる（#370）        |
| PV 1回で、Workers のリクエストを何件使うか（画面の Worker と API の Worker） | 2件。SPA の中の画面の移動は Worker を通らず、最初の HTML も静的アセットなので数えない。PV を送る `POST /api/analytics/pv` は、画面の Worker（`run_worker_first`）と、Service binding の先の API の Worker の2件に数えられる（上の O2 のリハーサルの数による）                   |

### 1日の書き込み量の見積もり

PV は、回答者1人あたり、部屋の画面を開く1回と、リロードやスリープからの戻りで3回ほど、と見た。ホストは、問題セットの一覧・編集・進行の画面で数回。回答の受理（`answer_accepted`）が一番多い。

| 日                                     | 内訳                                                          | 書き込み |
| -------------------------------------- | ------------------------------------------------------------- | -------- |
| 1回の本番（1部屋 × 20名 × 10問）       | 回答 200、参加 20、PV 約 100、ほかの出来事 数件               | 約 330   |
| SC1・SC2 の上限（5部屋 × 50名 × 10問） | 回答 2,500、参加 250、PV 約 1,000、ほかの出来事 数十          | 約 3,800 |
| O2 のリハーサル（5部屋 × 50体 × 3問）  | 回答 750、参加 250、ほかの出来事 数十。ボットは PV を送らない | 約 1,000 |
| 上限で遊んだ日に、リハーサルもした     | 上の2行の合計                                                 | 約 5,000 |

どの日も、書き込みの上限（10 万件/日）の5%に収まる。PV で増える Workers のリクエストは、一番多い日でも約 2,000 件（10 万件/日の2%）。

## Decision Drivers

- DD1 セキュリティ（ADR 0004・0006・S3）: 外のスクリプトを本番のオリジンで動かさない。CSP（`script-src 'self'`）を緩めない。部屋の URL を外へ送らない
- DD2 個人情報（S5）: 記録にも、外へ渡すものにも、人や端末を指す値を入れない。UU（何人が使ったか）は数えない
- DD3 正確さ: 部屋の出来事は、サーバーで確定した事実を数える。ブラウザが送ったかどうかで数がずれない
- DD4 コスト（C1）: 無料で動く。本番の進行が使う枠（Workers のリクエスト・DO）を大きく食わない
- DD5 変更の小ささ: Worker の secret、外向きの `fetch`、部屋の DO の migration を増やさない。本番以外（E2E・dev・ローカル）では記録しない
- DD6 ロックイン耐性（ADR 0008）: Go 版へ向けても、画面のコードを変えずに済む

## Considered Options

- W1. Workers Analytics Engine に記録し、アプリの外（Grafana Cloud か `curl`）で見る
- W2. Workers Analytics Engine に記録し、アプリの管理画面（`/admin/analytics`）で見る
- W3. Google のタグ（GTM、または gtag.js と GA4）をブラウザに入れる

## Decision Outcome

採用する選択肢: 「W1」。API の Worker に Analytics Engine の binding を1つだけ足し、決まったキーだけを記録する。集計はアプリの外で、SQL API を Grafana Cloud か runbook の `curl` で読んで見る。

|     | W1 Analytics Engine + 外で見る                                                  | W2 Analytics Engine + 管理画面                                                                                                              | W3 Google のタグ                                                                                                  |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| DD1 | 画面から送るのは同じオリジンへの beacon だけで、CSP は変わらない                | W1 と同じ                                                                                                                                   | CSP を緩める（下の「W3 を採らない理由」）。部屋の URL（`/r/<部屋 ID>`）が、消す設定をしない限り Google へ送られる |
| DD2 | 決まったキーだけで、人や端末を指す値はない                                      | W1 と同じ                                                                                                                                   | IP・端末を見分ける Cookie（`_ga`）が Google へ渡る。S5 に例外が要る                                               |
| DD3 | 部屋の出来事は、DO と API が確定した直後に書く                                  | W1 と同じ                                                                                                                                   | ブラウザが送るので、広告ブロッカー・送る前に閉じたタブ・二重の送信でずれる                                        |
| DD4 | 書き込みは 10 万件/日の5%以内。読むのは開発者が見るときだけ                     | 画面を開くたびに SQL API を読む                                                                                                             | 無料                                                                                                              |
| DD5 | binding を1つ足すだけ。読むトークンは手元か Grafana に置き、Worker には置かない | Worker に Cloudflare の API トークン（secret）が要る。外向きの `fetch` が `lookupGithubUser` に続いて2つ目になる（ADR 0013 の約束が変わる） | コードの変更は少ないが、CSP・S5・ADR 0004 の前提を変える                                                          |
| DD6 | 画面は同じオリジンの `/api/analytics/pv` に送るだけ。Go 版はその口を持てばよい  | W1 と同じ                                                                                                                                   | 画面に入れるので、サーバーに関わらない                                                                            |

W2 は、W1 の書き込み側をそのまま使い、読む側を足すだけで作れる。必要になったら、そのときに足す（Consequences の見直しの合図）。

### W3 を採らない理由

- **CSP を緩める**: GTM の入口はインラインのスクリプトなので、nonce・hash・`'unsafe-inline'` のどれかが要る。nonce は要求のたびにサーバーが作る値なので、静的アセットで配っている `index.html`（`_headers` で CSP を付けている）では使えない。使うには、HTML を Worker で返すことになり、ページを開くたびに Workers のリクエストを使う。さらに `https://www.googletagmanager.com` を `script-src` に許すことになる。GTM のカスタム JavaScript 変数は `'unsafe-eval'` がないと動かない
- **ADR 0004 の前提を崩す**: 回答者の秘密は localStorage にあり、XSS 対策が HttpOnly の代わりになっている（ADR 0004）。外のスクリプトは、その秘密と同じオリジンで動く。Swagger UI も、外の CDN のスクリプトを読むので本番に置かなかった（[testing.md](../architecture/testing.md#swagger-ui-で-http-api-を試す)）。解析のためだけに、その前例を破らない
- **GTM の管理画面から、任意の JS を本番のオリジンに入れられる**: GTM のコンテナを編集できる Google アカウントがあれば、デプロイなしで、本番の画面にスクリプトを足せる。そのスクリプトは、CI・レビュー・ルールセット・本番の承認（ADR 0012）のどれも通らない
- **S5 に例外が要る**: Google へ IP と端末を見分ける Cookie が渡り、UU も数えられる。S5 は「アプリが回答者に求め、保存し、画面に出すもの」を名前だけに絞っている。その外に、Google が持つデータが増える
- **部屋の出来事がずれる**: 参加や回答の受理は、部屋の DO が確定させる。ブラウザで数えると、広告ブロッカーやタブを閉じたときに送られず、確定した数と合わない

gtag.js と GA4 を直に入れる場合（GTM なし）も、CSP の緩め方（`script-src` の Google のホストと、インラインの初期化）と、S5・部屋の出来事のずれは同じように残る。

### 決めた形

#### 保存先と、本番以外の止め方

- `apps/api/wrangler.jsonc` の先頭（本番）に、binding `ANALYTICS`（dataset `zubakui_events`）を1つだけ足す。画面の Worker には足さない。PV も API の Worker が書く
- `env.e2e` には書かない。binding は環境に引き継がれないので、E2E では `env.ANALYTICS` が `undefined` になり、何も記録しない。wrangler が出す WARNING は受け入れ、`wrangler.jsonc` のコメントに理由を書く。`env.e2e` に別の dataset を書けば警告は消える。しかし、そうすると「本番以外で記録しない」守りが、ローカルでは書き込みが捨てられる作りに頼る形になる。binding がなければ何もしない、というコードの形で守るほうを選ぶ
- `vite dev` と Workers のテスト（vitest-plugin）は先頭の設定を読むので、binding がある。ただし、ローカルの書き込みは捨てられるので、記録はされない。テストは書き込みを集める fake の binding に差し替えて確かめる（#366）

#### 書き込みの窓口

- 書き込みは `apps/api/src/analytics/record.ts` の1か所に絞る。引数は決まったキーの型（出来事の名前の `as const` の配列から作る型）だけを受けるので、部屋 ID や名前を渡す口がない
- binding は `{ ANALYTICS?: AnalyticsEngineDataset }` で受け、なければ何もしない。E2E では実際に `undefined` になる。`wrangler types` も、`env.e2e` にない binding を `ANALYTICS?: AnalyticsEngineDataset` の省略できる型にするので、`?.` を付け忘れると型エラーになる（`wrangler` 4.160.0 で 2026-11-19 に確かめた）
- `writeDataPoint` は `await` せず、`try/catch` で包む。失敗しても投げ返さず、ログにも出さない。解析のために進行を止めない（A1）
- binding は外向きの `fetch` ではない。「外向きの `fetch` は `lookupGithubUser` だけ」という約束（ADR 0013）は変わらない

#### データ点の形

1つの出来事を1行として書く。

| 欄        | 中身                                                                                |
| --------- | ----------------------------------------------------------------------------------- |
| `index1`  | 出来事の名前（下の表の8つ）                                                         |
| `blob1`   | `source`。`app`（ふつうの利用）か `bot`（負荷試験のボット）                         |
| `blob2`   | `page_view` のときの、ルートのテンプレート（`/r/$roomId` など）。ほかの出来事では空 |
| `blob3`   | `room_ended` のときの、終えたときの段階（`lobby`・`question`…`final`）。ほかでは空  |
| `doubles` | 使わない                                                                            |

- index を出来事の名前にするのは、間引きが index ごとに行われるためである。量の多い `answer_accepted` だけが先に間引かれ、数の少ない `room_created` などは間引かれにくい
- 件数は `SUM(_sample_interval)` で数える。人数や時間などの数は記録しないので、`doubles` は使わない
- 時刻は Analytics Engine が付ける `timestamp` を使う

#### 記録するもの

| 出来事                 | 書く場所                  | 書くとき                                              | 数えないもの                                                                   |
| ---------------------- | ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `room_created`         | `POST /api/rooms`         | 201 を返す直前                                        | 404・検証の失敗                                                                |
| `question_set_created` | `POST /api/question-sets` | 作成に成功したあと                                    | 検証の失敗                                                                     |
| `participant_joined`   | 部屋の DO の `join`       | `joined` を送ったあと                                 | 断った参加（`room_ended`・`room_full`・`name_taken`）と、`resume` のつなぎ直し |
| `answer_accepted`      | 部屋の DO の `answer`     | 受理したとき                                          | `not_accepting`・`invalid_choice`・`already_answered`                          |
| `game_started`         | 部屋の DO の進行操作      | `lobby` から最初の問題を出したとき                    | 断られた操作                                                                   |
| `final_reached`        | 部屋の DO の進行操作      | `final` に移った1回                                   | 断られた操作                                                                   |
| `room_ended`           | 部屋の DO の進行操作      | 部屋を終えた1回。`blob3` に、終えたときの段階を入れる | 2回目の `endRoom`（断られる）                                                  |
| `page_view`            | `POST /api/analytics/pv`  | 許可リストにあるルートのテンプレートが届いたとき      | 許可リストにない値（400）                                                      |

- 部屋の DO の出来事は、`transactionSync` が確定した**あと**に、確定した結果を見て1回だけ書く。トランザクションの中で書くと、確定しなかった出来事を数えてしまう
- 締切の alarm（`closeAnsweringIfDue`）は、上の進行の出来事を書かない

#### 記録しないもの

- 部屋 ID・`participantId`・回答者の名前・問題セットの名前・問題文
- IP・国・User-Agent・ホストの `user.id`（`ownerId`）・GitHub の名前
- PV の実際のパス・search・referrer・`document.title`
- UU を数える値（端末を見分ける ID や Cookie）

`source` を決めるために、API は負荷試験の User-Agent を読む。ただし、読んだ値そのものは記録せず、`app` か `bot` にしてから書く。

#### 「完走」の数え方

- 最終結果まで進んだ部屋は、`final_reached` で数える
- 途中で終えた部屋は、`room_ended` のうち `blob3` が `final` でないもので数える。`endRoom` は `final` のあとでも受け付ける（`room-flow.ts`）ので、`room_ended` をそのまま数えると、最終結果のあとに終えた部屋も入ってしまう。`blob3` を見ると、どの段階で止めたかも分かる
- `room_created` から、`final_reached` と途中の `room_ended` を引いた差は、終えていない部屋の数である。これには、ホストが終えずに閉じた部屋と、まだ進行中の部屋の両方が入る。部屋 ID を記録しないので、部屋ごとに突き合わせて分けることはできない。本番は1〜2時間で終わる（A1）ので、数える期間の終わりを1日以上前にすれば（今日の分を入れなければ）、進行中の部屋はほぼ残らず、差はおおむね終えずに閉じた部屋になる

#### PV の送り方

- 画面は、`createAppRouter` の `router.subscribe('onResolved')` で、最後に一致したルートの `routeId`（ルートのテンプレート）だけを取る。同じ `routeId` が続くとき（search だけが変わったとき）は送らない
- 送り先は同じオリジンの `POST /api/analytics/pv` で、`navigator.sendBeacon` に `application/json` の本文 `{ routeId }` を渡す。失敗は無視する。CSP は `connect-src 'self'` のままで通る
- API は `csrf()` と小さい `bodyLimit` を付け、protocol の許可リスト（`z.enum`）で確かめてから書き、204 を返す。許可リストにない値や余分な項目は 400。Cookie での認証は求めない
- 許可リストは protocol に置き、HTTP の形として `openapi.json` に出る（ADR 0011）。Go 版は同じ確かめ方をして 204 を返し、何も記録しない。練習用の環境の利用は数えないためで、契約テストは両方のサーバーに同じように流せる
- PV はブラウザからだけ来るので、`source` はいつも `app`

#### ボットの見分け方

- 負荷試験のボットは `User-Agent: zubakui-loadtest/1` を付ける。API はこれを見て `source` を `bot` にする
- 部屋の DO は、`initialize` で受けた `source` を `ctx.storage.kv` に置き、DO の中の出来事はそこから読む。値がない部屋（この印より前に作った部屋）は `app` とする。解析のために、デプロイしたら戻せない `ROOM_MIGRATIONS` は増やさない
- この印は偽れる。統計の雑音を分けるための印であり、守りには使わない

#### 見方

- 集計は SQL API を読んで見る。Grafana Cloud（Altinity の ClickHouse のプラグイン）か、runbook の `curl` を使う
- 読むためのトークン（`Account Analytics Read` だけ）は、手元の環境変数か Grafana のデータソースに置く。Worker の secret にはしないので、`secrets.required` と `.dev.vars.example` は変わらない
- アプリに集計の画面は作らない

## Consequences

- 良い影響: CSP・S3・S5・ADR 0004 の前提を変えずに、画面ごとの PV と部屋の出来事を数えられる。部屋の出来事は、サーバーで確定した数そのものになる
- 良い影響: 増える設定は binding 1つだけで、Worker の secret・外向きの `fetch`・部屋の DO の migration は増えない。E2E・dev・ローカルでは記録しない
- 良い影響: 部屋 ID や名前を渡す口が型にないので、あとで出来事を足しても、記録しないものが紛れ込みにくい
- 悪い影響: `POST /api/analytics/pv` は、認証のない書き込み口になる。偽の PV を入れて数を汚すことは防げない。無料枠については、偽の PV 1回で Workers のリクエストを2件使うので、Analytics Engine の書き込み（10 万件/日）より先に Workers の 10 万件/日が尽きる。どの `/api/*` でも同じように Workers の枠は使えるので、新しい弱点ではなく、#348 で扱う「守れない枠」と同じものになる
- 悪い影響: 量が多いと間引かれるので、件数は推定値になる。見積もりの量（10 万件/日の5%以内）では間引かれる見込みは小さいが、読むときはいつも `SUM(_sample_interval)` を使う
- 悪い影響: E2E の起動とビルドのたびに、`env.e2e` に binding がないという wrangler の WARNING が出る
- 悪い影響: データは3か月で消える。長く残したいときは、手元へ書き出す
- 悪い影響: 書き込みが上限を超えたときの動きは、文書に書かれていない。超えた日の数は欠ける
- 見直しの合図:
  - PV の数が、作った部屋や参加の数から説明できないほど増えた（偽の PV）。そのときは、#348 の ADR と #356 の絞り込みに `POST /api/analytics/pv` を入れる。#348・#356 が先に入れば、#368 で最初からその仕組みに載せる
  - Analytics Engine の書き込みが、1日 5 万件（上限の50%）を超えた日があった
  - アプリの中で集計を見たくなった。そのときは W2 を、この ADR の書き込み側の上に足す。Worker に持たせるトークンと2つ目の外向きの `fetch` は、別の ADR で決める
- 対応事項（#366）: binding と `record.ts` を作り、`room_created` と `question_set_created` を記録する。`env.e2e` に書かない理由を `wrangler.jsonc` のコメントに書く。本番の設定に binding があり、`env.e2e` にないことを `api-bundle` で確かめる。開発の入口からは binding を外さない
- 対応事項（#367）: 部屋の DO の5つの出来事を記録する。`room_ended` には、終えたときの段階を `blob3` に入れる
- 対応事項（#368）: PV の許可リストを protocol に置き、`POST /api/analytics/pv` と画面の送り手を作る。すべての `routeId` が、許可リストか除外リストのどちらかにあることをテストで確かめる
- 対応事項（#369）: 負荷試験のボットに印を付け、`source` を `bot` にする
- 対応事項（#370）: 読み方（トークン、`curl`、決まったクエリ、Grafana Cloud）と、無料枠の見方を runbook に書く。途中で終えた部屋は `blob3` が `final` でない `room_ended` で数える
- 対応事項（#366〜#368）: 次のことを自動テストで確かめる
  - binding がないときは何もしない。`writeDataPoint` が投げても、応答と進行は変わらない
  - 書く形が決まった形で、部屋 ID・名前・IP が入らない
  - 部屋の出来事は1回だけ書かれる。重複した回答・`resume`・断られた操作・2回目の `endRoom`・DO の起こし直し（`evictDurableObject`）で二重に数えない
  - `/r/<部屋 ID>` を開いたときに送る値が `/r/$roomId` で、部屋 ID を含まない
- 対応事項: 要件定義書に O4 を足し、スコープ外に「アプリの中で解析の集計を見る画面」を足す。docs/README.md の一覧と、CLAUDE.md の ADR の範囲を直す
