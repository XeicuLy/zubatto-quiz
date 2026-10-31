# テストの仕組み

`apps/api` の Workers の実行環境でのテスト、通しの E2E（`e2e/`）、O2 のリハーサル用のボット（`tools/loadtest`）が、どう動き、どこに何があるかをまとめる。決めた理由の大もとは ADR にあり、ここには ADR に書いていない約束と、テストの道具の使い方を書く。

コードを書くときに守る約束は、[CLAUDE.md](../../CLAUDE.md) に1行ずつ残している。この文書はその説明で、見出しを変えるときは CLAUDE.md のリンクも直す（docs-check が確かめる）。手元での動かし方は [README の「よく使うコマンド」](../../README.md#よく使うコマンド)にある。

## Workers のテスト

- `@cloudflare/vitest-plugin`（前の名前は `@cloudflare/vitest-pool-workers`）を使い、DO と D1 をローカルの Workers の実行環境で動かす。眠り（Hibernation）や再起動を試すときは `evictDurableObject` を使う。接続を残すか切るかの違いは [backend.md の「回答者の参加とつなぎ直し」](backend.md#回答者の参加とつなぎ直し)にある
- `env` と `exports` は `cloudflare:workers` から import する。`cloudflare:test` の `env` と `SELF` は非推奨。`cloudflare:test` から取るのは `runInDurableObject` などのテストの道具だけで、テストでないコードで import すると oxlint が落とす
- DO はテストと同じ isolate で動く。そのため `vi.useFakeTimers({ toFake: ['Date'] })` と `vi.setSystemTime` で、DO の中の `Date.now()` も進む。alarm は `runDurableObjectAlarm(stub)` で動かす
- DO の stub の RPC が返す Promise を、`expect(...).rejects` にそのまま渡さない。テストは通るが、vitest が Unhandled Rejection を報告して、実行全体が落ちる。`then` だけを呼ぶふつうの Promise に包む（`room/initialize.test.ts` の `settle`）
- `src/` とテストは Workers の型で、`vitest.config.ts` は node の型（`tsconfig.node.json`）で確かめる。2つを混ぜると、`Request` などのグローバルがぶつかる
- `apps/api/worker-configuration.d.ts` は生成したもの。`wrangler.jsonc` を変えたら次を動かす。パッケージの `tsc` のスクリプトは `wrangler types --check` を動かすので、古いままだと CI が落ちる。oxfmt と oxlint はこのファイルを飛ばす。整形すると、このチェックが落ちるため

  ```sh
  pnpm --filter @zubatto-quiz/api run types
  ```

- D1 のマイグレーションの当て方と、テストの間で D1 を空にする方法は、[backend.md の「D1 のスキーマ」](backend.md#d1-のスキーマ)にある
- 見えない文字は、ソースにエスケープで書く（`'\u200D'`、`'\u3000'`）。Claude Code の Write ツールは、中身の `\u` のエスケープを文字そのものに変えてしまう。そういうファイルはスクリプトで書くか、書いたあとで確かめる

## HTTP と WebSocket のテストの道具

- HTTP のルートのテストは `test/host-request.ts` を使う。`beforeEach` で `resetHosts`（ホストは `alice` と `mallory`）を呼び、`apiRequest` か `apiRequestAs` で送る。どちらも、ブラウザと同じく `Origin` と `Sec-Fetch-Site` のヘッダーを付ける。`csrf()` がそれを見るため（[backend.md の「問題セットと部屋を作る」](backend.md#問題セットと部屋を作る)）
- WebSocket のテストは `test/room-socket.ts` を使う
  - `newRoom(ownerId, questionCount)`: 初期化した部屋を作る。持ち主は `alice` で、問題は既定で1問。`roomSnapshot.questionCount` は1以上でなければならないため。n 問目は `testQuestion(n)` で、ID は `q-n`
  - `connect` は DO へ直につなぐ。`openSocket` は 101 が返ったかを確かめ、クライアントの側を受け入れる。ほかに `closeOf` と `newToken` がある
  - `messageReader` は、呼んだときからメッセージをためておくので、取りこぼさない
  - `nextOf(socket, type)` は、その種類のメッセージが届くまで、ほかのものを読み飛ばす
  - `drain(socket)` は読めない文字列を送り、その `invalid_message` の返事より前に届いたものをすべて返す。`exchange(socket, message)` は、先にメッセージを送ってから同じことをする
  - `joinPlayer`・`resumePlayer`・`connectHost` は、[backend.md の「回答者の参加とつなぎ直し」](backend.md#回答者の参加とつなぎ直し)にある
- アタッチメントは、`runInDurableObject` の中で `getWebSockets().map(getAttachment)` として読む
- 断られたホストの操作には、返事がない。そのため `host-commands.test.ts` は、操作のすぐあとに読めない文字列を送り、その `invalid_message` の返事まで読む。1つの接続のメッセージは順に処理されるので、返事が来たときには操作が終わっている
- await する処理（`join`・`resume`）は、最初の返事が届いた時点で終わっている。`drain` は、その返事を読んでから呼ぶ
- `close-question.test.ts` は、50人分の結果を作る時間を `performance.now()` で挟んで、P4 を測る。このテストでは `Date` を偽物にしない

## テスト専用のログイン

- Better Auth の `testUtils` のプラグインは、テスト専用の auth（`test/auth/create-test-auth.ts`）にだけ入れる（[backend.md の「ホストの認証」](backend.md#ホストの認証)）
- テスト用のログインの入口は、本番の入口には入れない。実行時の環境変数で閉じておく形でも入れない。本番のバンドルに入口のコードが入っていれば、環境変数の入れ間違いがそのまま、誰でもホストになれる入口になる。本番の入口のファイルから import されない、テスト専用の入口にだけ置く（[ADR 0003](../adr/0003-host-identification-and-host-connection.md) の対応事項）
- E2E は、別の入口のファイル `apps/api/test/e2e-entry.ts` を使う。本番の `app` を import し、`POST /api/e2e/login`（パスは `test/e2e-login-path.ts`）だけを足す。この入口は、呼ぶたびに新しいホスト（`user`・`account`・許可リストの行）を作り、`testUtils` の `getCookies` の結果を返す。Playwright の `context.addCookies` にそのまま渡せる。セッションは本物の `session.create.before` を通る
- `apps/api/vitest.bundle.config.ts`（project `api-bundle`、node、`test/bundle/`）は、両方の env で `wrangler deploy --dry-run` を動かし、本番のバンドルにそのパスがなく、E2E のバンドルにはあることを確かめる。両方を見るので、パスの打ち間違いでテストが通ってしまうことはない。Workers の project は `test/bundle/` を外し、`tsconfig.node.json` がそれを型チェックする

## 通しの E2E

`e2e/` の Playwright のテストは、次の4つ。CI では `e2e` の job で動き、`ci` と同じく必須のチェックになっている（[branch-protection.md](../runbooks/branch-protection.md#何を決めているか)）。

| spec                       | 確かめること                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `full-game.spec.ts`        | ログイン → 問題セットの編集 → 部屋を作る → 2人が参加 → 3問（①②、1問目は ③ も）→ 最終ランキング                                  |
| `csp.spec.ts`              | CSP の違反を集める仕組みが、インラインのスクリプトを捕まえられること                                                            |
| `player-reconnect.spec.ts` | リロード、別のタブ（X1）、失敗する `resume`、サーバーの側で切れたとき、名前の重なり、形の悪い部屋の ID                          |
| `a11y.spec.ts`             | 参加の画面、ホストの待機画面、回答中とホストの受付中の画面、ホストの ① で、axe の違反がないこと。違反を見落とさないかも確かめる |

### 本番と同じビルドで動かす

- E2E は `vite build` と `vite preview` に向けて動かす。`vite dev` は使わない。CSP を書いた `_headers` は、そちらでしか効かないため
- `apps/web` の `e2e:serve` は、`.wrangler/e2e` を消し、`CLOUDFLARE_ENV=e2e vite build --mode e2e` でビルドし、`db:migrate:e2e` でマイグレーションを当て、`vite preview --mode e2e --port 4173` を動かす。ブラウザでの確かめにも使える

  ```sh
  pnpm --filter @zubatto-quiz/web run e2e:serve
  ```

- `CLOUDFLARE_ENV` はビルドにだけ付ける。preview は平らにした `dist/*/wrangler.json` を読むので、そこで `CLOUDFLARE_ENV` を付けると、env がないという警告が出る
- `--mode e2e` で `persistState` を `.wrangler/e2e` に切り替える。こうして E2E は `vite dev` のデータに触れない。`database_name` を変えても手元の D1 のファイルは分かれず、分けるのはフォルダ
- 2つの `wrangler.jsonc` に `env.e2e` がある。API のほうは `main` が `test/e2e-entry.ts` で、名前は `zubakui-api-e2e`。画面のほうの `env.e2e` は、この名前に Service binding でつなぐ。`durable_objects`・`d1_databases`・`secrets`・`services` は env に引き継がれないので、`env.e2e` の中にもう一度書いている。env があると、ふつうの `wrangler deploy` は警告を出すので、本番のデプロイは `--env=""` を付ける
- `apps/api/.dev.vars.e2e` は、テスト用の値でコミットしている（`.gitignore` で戻している）。`CLOUDFLARE_ENV=e2e` のとき、wrangler は `.dev.vars` より先に `.dev.vars.e2e` を読み、Vite のプラグインはその結果を `dist/zubakui_api/.dev.vars` に写す。これがないと、開発者の本物の `.dev.vars` が E2E のビルドに写ってしまう
- `vite build --mode e2e` は、`apps/web/.wrangler/deploy/config.json` を E2E のビルドに書き換える。そのため、画面の Worker を `wrangler deploy` するときは、いつもその直前に `vite build` する（本番のデプロイの workflow はそうしている。[operations.md の「デプロイの workflow」](operations.md#デプロイの-workflow)）

### spec の書き方

- 人ごとに `browser.newContext()` を分ける。Cookie と localStorage が別になるので、ホストと回答者、回答者どうしが混ざらない
- 回答者の選択肢のボタンの名前は、番号と文（`1富士山`）になる。`choiceButton` は `^<n>\s*<text>$` で探す
- `collectCspViolations(context)` は、`Content Security Policy` を含むコンソールのエラーを集める
- `player-reconnect.spec.ts` と `a11y.spec.ts` は、`beforeAll` で HTTP API から部屋を1つ作る（`e2e/helpers/room.ts` の `createRoom(context, questionSet)`）。画面から部屋を作る流れは `full-game` が確かめる。`player-reconnect` は、ケースごとに context と回答者の名前を分ける
- `e2e/helpers/player.ts` には、`joinRoom`（`full-game` と共有）、`countWebSockets`（`page.on('websocket')`）、`relayPlayerSocket` がある。`relayPlayerSocket` は `page.routeWebSocket` と `connectToServer()` で本物の DO へ中継し、`cut()` でサーバーの側を閉じ、`restore()` でつなぎ直しをまた通す。この関門がないと、最初のつなぎ直しは 250〜500 ms で終わり、「再接続中」が `toBeVisible` に見つかる前に消えてしまう
- ルートの `package.json` は `@zubatto-quiz/protocol` に頼っているので、spec は API の応答を protocol のスキーマで読む。秘密を置く localStorage のキーは、`apps/web` の `tokenKey` を import して使う
- `e2e/**` と `playwright.config.*` は、oxlint ではテストのコードとして扱う（`@playwright/test` が `**/test` の形に当たる）

### アクセシビリティの自動チェック

- `a11y.spec.ts`（#116）は、`e2e/helpers/axe.ts` の `a11yViolations(page)` が `[]` になることを、上の画面ごとに確かめる。`@axe-core/playwright` で `wcag2a`・`wcag2aa` を見て、違反を `{ id, help, targets }` に絞って返す。2つ目のテストで、名前のないボタンを捕まえられることも確かめる
- `color-contrast` は #126 まで止めている。#135 で戻す
- axe は `page.evaluate` で入れる。CSP はこれを止めないので、`bypassCSP` は使わない。ただしこの spec では CSP の違反を集めないので、`csp.spec` の context とは分けたままにする
- ホストの context は、`beforeAll` で作って `afterAll` まで開いておく。`/api/e2e/login` は呼ぶたびに新しいホストを作るので、新しいホストはその部屋の持ち主ではなく、4404 で断られる
- ルートの tsconfig には DOM の型がないので、ブラウザの側で動く式は文字列として `page.evaluate` に渡す

## O2 のリハーサル用のボット

使い方、秘密の扱い、引数は [tools/loadtest/README.md](../../tools/loadtest/README.md) にある。ここには、README に書いていない作りの理由を書く。

- Node の型の取り除き（type stripping）で `node src/run.ts` として動く。頼るのは protocol と zod だけ
- Node 24 の組み込みの `WebSocket`（undici）は `{ headers }` を受け取る。そのため `ws` のパッケージなしで、ボットが `Origin` を、ホスト役が `Cookie` も付けられる（2026-10-17 に確かめた）
- `plannedMetrics` は、走らせる前に予定の件数を決めておく。途中で部屋が死んでも、その部屋は表から消えずに、件数が足りない「満たしていない」の行になる
- 本番の環境でのリハーサル（2026-10-20）は [o2-rehearsal.md](../rehearsal/o2-rehearsal.md) に残している。どの行も満たし（いちばん遅くて 82 ms）、1回の本番は無料枠の1日の上限のどれも1%に届かない
- `wrangler tail` は混むと間引く。リハーサルでも `/ws/play` は 270 本のうち 170 本しか残らなかった。件数はダッシュボードで見る
- デプロイで接続が切れるかは、[o2-rehearsal.md の「わかったこと」](../rehearsal/o2-rehearsal.md#わかったこと)にある。中身が同じ API のデプロイでは切れなかったが、中身が変わるデプロイは確かめていないので、本番の最中に API をデプロイしない決まりは残す。接続をわざと切るときは `page.routeWebSocket` を使う。Playwright の `setOffline` も、開発者ツールの Offline も、開いている WebSocket を切らない
