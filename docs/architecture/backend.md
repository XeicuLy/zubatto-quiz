# バックエンドの仕組み

`apps/api`（Hono の Worker と部屋の Durable Object）と、それが使う `packages/protocol`・`packages/scoring` が、どう動き、どこに何があるかをまとめる。決めた理由の大もとは ADR にあり、ここには ADR に書いていない約束と、コードのどこで守っているかを書く。

コードを書くときに守る約束は、[CLAUDE.md](../../CLAUDE.md) に1行ずつ残している。この文書はその説明で、見出しを変えるときは CLAUDE.md のリンクも直す（docs-check が確かめる）。要件の ID（`S1` など）は[要件定義書](../requirements/zubatto-quiz.md)で引く。

## 全体の形

- 最初の版は、すべて TypeScript で Cloudflare の無料プランの上に作る。最初の本番のあとで、バックエンドを Go と Cloud Run（Terraform）で作り直す（[ADR 0001](../adr/0001-backend-runtime-and-realtime-transport.md)）。そのため、画面が頼るものにバックエンドの基盤の事情を持ち込まない。とくに **WebSocket の JSON メッセージの仕様は基盤に依存させず、画面とバックエンドで同じものを使う**。こうしておけば、作り直しで画面に手を入れずに済む
- Hono の Worker が1つと、**部屋ごとに1つの Durable Object（DO）** で動かす。DO は WebSocket Hibernation API と DO の SQLite を使い、部屋の状態・得点・回答の唯一の正本になる。ポーリングや SSE は使わない
- Worker は2つに分ける（[ADR 0006](../adr/0006-spa-and-api-worker-layout.md)）。`apps/web` は SPA を静的アセットとして配り、`/api/*` を Service binding で `apps/api`（Hono・DO・Better Auth）へ転送する。ブラウザからは1つのオリジンに見えるので、CORS も `crossSubDomainCookies` も使わない。API と WebSocket のパスは、すべて `/api/` の下に置く
- `GET /api/health` は `{ ok: true }` を返すだけの、生きているかの確かめ
- `apps/api` は `workers_dev: false` と `preview_urls: false` にしている。本番の最中は `apps/api` をデプロイしない。部屋の WebSocket が切れるため

## 問題セットと部屋を作る

- 問題セットは D1 に置き、`owner_id` で持ち主ごとに分ける（[ADR 0002](../adr/0002-question-set-storage-and-room-handoff.md)）。D1 を読み書きする層は、どれも `owner_id` を必須の引数に取る
- 部屋を作るときに問題セット全体を D1 から1回だけ読み、1つのトランザクションで部屋の DO の SQLite へ書く。遊んでいる間、部屋は D1 を二度と読まない。正解は締切まで DO の外に出さない（S2）
- `apps/api/src/routes/question-sets.ts` の HTTP API は、リポジトリが返す `undefined`/`false` を 404 にするだけにしている。そのため、ほかのホストの問題セットも、ない問題セットと同じに見える。エラーは protocol の `httpErrorSchema` の `{ error: code }` で返す。共通の `jsonBody`（スキーマに合わなければ 400）と `notFound` は `routes/common.ts` にある
- `getQuestionSet` は各問題の D1 の `id` も返し、部屋はそれを `questionId` として持つ。`GET /api/question-sets/:id` は、`QuestionSetDetail` に合わせてそれを取り除いて返す
- `POST /api/rooms`（`routes/rooms.ts`）は、`getQuestionSet` で問題セットを読み、`newUniqueId()` で DO を作り（S3。`idFromName` は使わない）、`initialize` の RPC を呼ぶ。この RPC は2回目の呼び出しを断り、部屋の行と問題を1つの `transactionSync` で書く。応答は `roomId`（`id.toString()` の16進64文字）と `joinUrl`（`BETTER_AUTH_URL` + `/r/:roomId`）を返す
- cookie で認証して状態を変えるルートは `.use(csrf(), requireHost)` を使う。`csrf()` を先に置くのは、セッションを読む前に断るため。`csrf()` は `Content-Type` のないリクエスト（本文のない `DELETE`）を `text/plain` として扱うので、テストではブラウザと同じく `Origin` と `Sec-Fetch-Site: same-origin` を送る

## ホストの認証

- Better Auth の GitHub ログインを使う（[ADR 0003](../adr/0003-host-identification-and-host-connection.md)）。`owner_id` は Better Auth の `user.id`
- GitHub のユーザー ID の許可リストは、新規登録のときに `user.validateUserInfo` で、行を書く前に確かめる。D1 にはトランザクションがないので、`account.create.before` で断ると `user` の行が残ってしまう。セッションを作るたびに、`databaseHooks.session.create.before` でもう一度確かめる
- `apps/api/src/auth` の `createAuthOptions(env)` を、本番の `createAuth` と、テスト専用の `test/auth/create-test-auth.ts` で共有する。テスト用のほうは `testUtils` を足すだけ。oxlint は、テストのコードの外で `testUtils` と `better-auth/test` を import すると落とす。`testUtils.saveUser` は `validateUserInfo` を通って断られるので、テストでは drizzle で `user` と `account` の行を入れる
- `BETTER_AUTH_URL`（画面の Worker の URL）と秘密の値は、`apps/api/wrangler.jsonc` の `secrets.required` に並べている。こうすると `wrangler types` が `.dev.vars` に頼らず、どれかを入れ忘れると `wrangler deploy` が失敗する。URL は秘密ではないが、`vars` の値はデプロイのたびにファイルの値へ戻るので、上書きを忘れると GitHub のコールバックが黙って localhost へ飛んでしまう。手元では `apps/api/.dev.vars` に、テストでは `vitest.config.ts` で値を渡す

## WebSocket の入口

- 入口は2つある。ホストは `/api/rooms/:roomId/ws/host`、回答者は `/ws/play`（同じ `/api/rooms/:roomId` の下）からつなぐ
- ホストの WebSocket の入口は、`Origin` を確かめ、cookie のセッションから `ownerId` を引いて DO へ渡す
- `routes/ws.ts` は次の順に確かめる。`Origin` が `new URL(c.req.url).origin` と同じか（違えば 403。ないときも 403 で、cookie を読む前に断る）、`Upgrade` があるか（なければ 426）、部屋の ID が小文字の16進64文字で `idFromString` に通るか（通らなければ `refuseConnection('room_not_found')` で 4404）。ホストの入口は、そのあとで `requireHost` を通す
- Worker は、ブラウザのリクエストをそのまま DO へ渡さない。`room/connections.ts` の `roomRequest` が、`Upgrade` と、ホストなら内部用の持ち主のヘッダーだけを持つ新しいリクエストを作る。そのため cookie や偽の持ち主のヘッダーは DO に届かない
- `index.ts` は `wsRoutes` を `roomRoutes` より先に登録する。`roomRoutes` の `csrf()` と `requireHost` が `/api/rooms/*` 全体にかかるため。順番を入れ替えると、回答者の入口が 401 になってテストが落ちる
- DO の `fetch` は同期で動く。初期化されていない部屋と、持ち主でないホストには、4404 `room_not_found` で閉じる（`refuseConnection`）。これは `ended_at` より先に確かめるので、ほかのホストの部屋は、HTTP API の 404 と同じく、ない部屋に見える（S1）
- ブラウザの WebSocket を HTTP のステータスで断ってはいけない。ブラウザはそれを読めず 1006 に見えるので、クライアントがいつまでもつなぎ直してしまう。HTTP 404 を返すのは、`readRoomEntry` が読めないリクエスト（ブラウザからは来ない）だけ
- DO は、その ID が部屋の持ち主のときだけ、アタッチメント `{ role: "host", ownerId }` を記録する。終わった部屋は、ホストを 4410 `room_ended` で断る（`refuseConnection`）。受け入れたホストには `hostReady`、`participants`、送り直しの順に送る。どれも同期の `fetch` の中で、101 を返す前に送るが、届くのはクライアントが開いたあとになる

## 進行の操作

- 進行の操作は、ホストの役割の接続からだけ受け付ける。`webSocketMessage` は `isHostCommand` とアタッチメントの役割を確かめ、回答者の接続には `not_host` を返す。`handleHostCommand`（`room/handlers/host-commands.ts`）はそのあとに動く
- 進行の順番は、protocol の `room-flow.ts` にある純粋な関数 `transition` が決め、表でテストしている。ホストの画面の `canSend(room, command)` はそれを包んでいるので、ボタンが押せるのは、DO がその操作を受け付けるときとちょうど同じになる。段階や `questionIndex` が合わない操作には `invalid_state` を返す
- 締切のあとの進み方は、① `revealed` → ② `fastest` →（③ `standings`）→ 次の `showQuestion`、最後の問題のあとは `showFinalRanking` だけ。`canShowStandings` は最後の2問で ③ を断るので、2問以下の部屋では ③ は出ない
- `retryQuestion` は締切の前（`question`/`accepting`）だけ使える。その問題の `answers` を消し、`question` へ戻して `questionShown` を送り直す。`endRoom` はどの段階からでも使え、未確認の接続も含めたすべての接続を 4410 `room_ended` で閉じる
- `applyHostCommand` は、状態を読み、`transition` を呼び、`room`（とやり直しの `DELETE`）を1つの `transactionSync` で書いてから配る。`questions.correct_index` は自分では読まず（S2）、D1 にも `fetch` にも触れない（P1）。`questionShown` には選択肢を入れず、`answeringStarted` で足す。①②③と最終結果は、コミットのあとに `sendResults` を呼んで送る

## 締切と採点

- 締切の採点（`room/handlers/close-question.ts`）: `closeAnswering` で、段階を `revealed` へ進めるのと同じ `transactionSync` の中で `scoreQuestion` が動く。`correct_index` を読み、各回答を `scoreAnswer` と `quickBonusPoints` で採点し、`question_scores` に `points` と `bonus_points` を書く（部屋のスキーマの v3、`CHECK (bonus_points BETWEEN 0 AND points)`。回答した人の行だけを書き、行がなければ0点）。最後に `questions.closed_at` を書く。`closed_at` がすでにある問題は飛ばす
- `initialize` のほかで `correct_index` に触れるのは、`scoreQuestion` と `results.ts` だけ
- `room.deadline_at`（部屋のスキーマの v2）は、受け付け中で部屋が終わっていない間だけ `now + limit_ms` を持つ。alarm の `closeAnsweringIfDue` は、同じ `applyHostCommand` を通して `closeAnswering` を送る。そのため、alarm がもう一度動いても締切が見つからず、何もしない
- alarm は1分ほど遅れることがある。そのため `handleHostCommand` は、どの操作を当てる前にも `closeAnsweringIfDue` を呼ぶ。そうしないと、締切を過ぎた `retryQuestion` が確定した回答を消してしまう。`handleAnswer` も同じ理由で、受け付け中かを確かめる前に呼ぶ。こうすると、締切を過ぎた回答は、alarm が動く前でも `not_accepting` になる

## 結果と送り直し

- 結果（`room/results.ts`）は保存しない。`readQuestionOutcome` が、締め切った問題の結果を `question_scores` と `answers` から決まった数のクエリで組み立て直し（P4）、純粋な関数 `revealedFor`/`myResultsFor`/`fastestFor`/`standingsFor`/`finalRankingFor` が scoring の関数を使って protocol のメッセージにする
- ① はホストに `revealed` を送り、回答者にはそれぞれ自分の `myResult` だけを送る。`myResult` の `bonusPoints` は `question_scores` から読み、計算し直さない（画面の `QuestionResult` は `bg-choice-4` のバッジで出す）。②③と `finalRanking` は全員に送る。送り直しも同じ関数を呼ぶ
- 送り直し（`room/resend.ts`）: `joined`/`resumed`/`hostReady` のあとで、`resendCurrentPhase` がその接続にだけ、今の問題の流れを最初から `QUESTION_FLOW` の順に、今の段階まで送る。`questionShown`、`answeringStarted`（`remainingMs` は `max(0, deadline_at - now)`、締切のあとは0）、①（ホストには `revealed`、回答者には自分の `myResult`）、②、③ の順。クライアントのストアは別の `questionId` のメッセージを捨てるので、`questionShown` を先に送る必要がある
- 受け付け中なら、ホストには `answerProgress` も送り、すでに回答した回答者には `answerAccepted` も送る。`final` では `finalRanking` だけを送り、`lobby` では何も送らない。`results.ts` に届くのは締切のあとだけなので、送り直しが `correctIndex` を早く運ぶことはない（S2）。そこにある `questionShownOf`/`answeringStartedOf`/`answerProgressOf` は、`host-commands.ts` と `answer.ts` が配るときにも使う
- 前の順位（`rankUp` と、一番順位を上げた人に使う）には、`joined_at` が前の問題の `closed_at` 以前の参加者だけを入れる。そのため、あとから入った人が順位を上げた人に数えられることはない。1問目には前の順位がない
- 順位に関わる情報（`position: hidden`、`fastest.ranksHidden`）は、`canShowStandings` が false のときにちょうど伏せる。そのため、2問以下の部屋では、どの問題でも伏せる

## 回答者の参加とつなぎ直し

- 回答者は、cookie を読まない別の入口を使う（[ADR 0004](../adr/0004-player-identification-and-reconnection.md)）
- クライアントは32バイトの秘密を作り、部屋ごとに localStorage へ置き、WebSocket の最初のメッセージで `join { name, token }` か `resume { token }` を送る。秘密は URL にもログにも入れない
- DO は SHA-256 のハッシュだけを持ち、ハッシュどうしを `timingSafeEqual` で比べる
- アタッチメントが `null` の接続は未確認の接続で、`join` か `resume` しか送れない。それ以外には `error { code: 'not_verified' }` を返す
- `room-do.ts` の `webSocketMessage` が、メッセージを decode してアタッチメントで振り分ける。メッセージの種類ごとの処理は `room/handlers/` に置く（今は `join.ts`・`resume.ts`・`host-commands.ts`・`answer.ts`・`close-question.ts`）。送るときは `room/send.ts` の `send`/`broadcast`/`sendToHosts` を使う。`send` は `OPEN` でない接続を飛ばし、`broadcast` はホストと回答者の接続にだけ届け（未確認の接続には届けない）、`sendToHosts` はホストの接続にだけ届ける
- `handleJoin` は先に `hashToken` を await し、そのあとで、接続がまだ `OPEN` で、アタッチメントがまだ `null` かを確かめ直す。`crypto.subtle.digest` はストレージの呼び出しではないので、その await の間に、alarm や新しい接続がタイムアウトで接続を閉じることがあり、同じ接続の2回目の `join` も通りうる
- 名前の重なりは `normalizeName` で比べる（NFKC のあと、ZWJ や異体字セレクタを含むすべての `\p{Default_Ignorable_Code_Point}` を取り除き、前後の空白を取る。大文字と小文字は区別する）。protocol の名前の確認が断るのは Cc と Cf だけなので、こうしないと、Cf の外の見えない文字でほかの人になりすませてしまう。正規化して `''` になる名前は `invalid_message` にする
- 断った `join` は `room_ended`/`room_full`/`name_taken` で閉じる。形の悪い秘密はハンドラまで届かない。`decodeClientMessage` が `invalid_message` で断るため
- `handleResume`（`room/handlers/resume.ts`）も、同じく await してから確かめ直す。`resume` は `participantId` を持たないので、`participants` の行（多くて50）をすべて読み、ハッシュを `timingSafeEqual` で比べる。`WHERE token_hash = ?` は使わない。終わった部屋は `room_ended` で閉じ、秘密が違うか `RESUME_WINDOW_MS`（`joined_at` から6時間）を過ぎていれば `resume_failed` で閉じる。`resumed.score` は `sum(question_scores.points)`
- X1: `resume` が通ったら、`closeReplacedConnections`（`room/replace-connection.ts`）が、同じ `participantId` のアタッチメントを持つほかの接続を、`resumed` を送る前に 4301 `replaced` で閉じる。`join` はこれを呼ばない。`participantId` が新しいため。`CLOSING` の接続にもう一度 `close()` を呼んでも例外にはならない（2026-10-12 に確かめた）
- 同じ参加者の新しい接続は古い接続を閉じ、古いタブは自動ではつなぎ直さない
- `participantId` は、いつもアタッチメントから取る。メッセージの本文からは取らない
- テストの `test/room-socket.ts` には `joinPlayer`・`resumePlayer`・`connectHost` がある。`connectHost` は `hostReady` と `participants` を先に読むので、待機中のテストはそのあとに配られたものだけを見る。`resume` も、その接続に `resumed` のあとで `participants` を送る。`evictDurableObject(stub, { webSockets: 'close' })` は古いクライアントを 1006 で切る。ただの evict は接続を残すので、次の `resume` がそれを 4301 で置き換える
- 未確認の接続は `acceptedAt:<ms>` のタグ（`pending-timeout.ts`）を付けて受け入れ、10秒後に 4408 `join_timeout` で閉じる。閉じるのは DO の `alarm()` と、数える前の `acceptConnection` の両方
- `scheduleAlarm`（`room/alarm.ts`）は、次の alarm を状態から計算し直す。いちばん古い未確認の接続の期限と `room.deadline_at` の早いほうにし、`getAlarm()` からは決めない。回答者がつながるたび、`startAnswering` のとき、`alarm()` の最後に動く

## 同時に起きる処理の約束

- 接続の上限は、`acceptWebSocket` の前に `getWebSockets()` で数える。その間に await を挟まない。`countOpenConnections` は `OPEN` の接続だけを数える。DO が閉じた接続は `CLOSING` のまま一覧に残るため
- 上限は入口ごとに分ける。回答者の入口は100（未確認の接続を含む）、ホストの接続は別に5で、アタッチメントの役割で見分ける。回答者の入口にどれだけ接続が押し寄せても、ホストを締め出してはいけない（#69）
- 上限を超えたら、`acceptConnection` は `accepted` の接続を返さず、`refuseConnection` が `server.accept()`（hibernation できず、`getWebSockets()` にも入らない）を呼んで 4503 `connection_limit` で閉じる。こうすると、クライアントはほかの失敗と見分けられる
- `join` の確かめ（NFKC で正規化して前後の空白を取った名前の重なり、protocol の50人の上限 `MAX_PARTICIPANTS`。ホストの待機画面もこの数を出す）と行の追加は、await のない同期の SQL で行う
- 1問に1回だけの回答は、`UNIQUE(question_id, participant_id)` と、受け付け中かの確かめを1つのトランザクションで行って守る
- `handleAnswer`（`room/handlers/answer.ts`）は、回答者の役割の接続からだけ `answer` を受け付ける（ホストの接続には `invalid_state`）。1つの `transactionSync` の中で、受け付け中の問題を読み（段階が `accepting` でない、部屋が終わっている、`questionId` が今の問題でない、のどれかなら `not_accepting`）、`choiceIndex` をその問題の選択肢の数と比べ（`invalid_choice`）、`ON CONFLICT (question_id, participant_id) DO NOTHING` で入れて、`rowsWritten`/`changes()` が0なら `already_answered` にする。`INSERT OR IGNORE` は使わない。CHECK の違反も飲み込むので、`already_answered` に見えてしまう
- `answers.elapsed_ms` には `normalizeElapsedMs` の値を入れる。クライアントの値を信じ（P2）、`limitMs` を超える値は断らずに `limitMs` に切り詰め、負の値は decode で `invalid_message` になる。`answerAccepted` は保存した値を返す。`answerProgress` はホストの接続にだけ送り、回答者には送らない

## メッセージの形

`packages/protocol` に、WebSocket のメッセージ、close code、問題セットの形、HTTP のリクエストと応答の形（`src/http/`）の zod スキーマを置く。画面は Hono RPC ではなく、このスキーマで HTTP API を呼ぶ。そのため画面は Hono に頼らない。

- 部屋の DO は、受け取ったものを `decodeClientMessage` で decode し、`encodeServerMessage` を通して送る。どちらも知らない項目を取り除くので、紛れ込んだ `participantId`・`correctIndex`・`rank` が外へ出ることはない
- サーバーのメッセージに足す項目には `.default()` を付ける（`myResult.bonusPoints` は `.default(0)`）。こうすると、`web` だけをデプロイしても、新しい画面が古い API のメッセージを捨てない（[deploy.md の「何が動くか」](../runbooks/deploy.md#何が動くか)）。`ws.schema.json` は出力の形で書くので、その項目はそこでは必須のまま残る。DO はメッセージを出力の型（`MyResult`）で作るので、その項目を落とすこともできない
- `schema/ws.schema.json` は生成したもので、Go で作り直すときの正本になる。スキーマを変えたら次を動かす。ファイルが古いとテストが落ちる

  ```sh
  pnpm --filter @zubatto-quiz/protocol run schema
  ```

- `schema/openapi.json`（OpenAPI 3.1、`src/openapi.ts`）は、HTTP API（`/api/question-sets` と `POST /api/rooms`）の同じもので、同じ `schema` スクリプトで書き、同じように確かめる。リクエストの本文は `toDef(schema, 'input')`、応答は `'output'` で書く。OpenAPI 3.1 は zod の JSON Schema 2020-12 をそのまま受け取る
- ルートのステータスコードを変えたら、その `responses` と `openapi.test.ts` の表も直す。`csrf()` の 403 と、JSON として読めない本文の 400 は `text/plain` になる。JSON Schema で書けない条件（`.refine()`、`.trim()`）は、`.meta({ description })` か `info.description` に書く
- テストは、コミットしたファイルに `@readme/openapi-parser` の `validate` をかける。`validate` は `$ref` をその場で解決して書き換えるので、呼ぶたびにファイルを読み直す
- `@hono/zod-openapi` も Swagger UI も Worker には入れない。手元では、リポジトリの直下で次を動かし、1つの HTML ファイルにして見る。CLI v2 の `preview` は Redocly のプロジェクト用で、1つのファイルは開けない（2.57.0 で 2026-10-18 に確かめた）

  ```sh
  pnpm dlx --package=@redocly/cli@<ver> redocly build-docs packages/protocol/schema/openapi.json -o .playwright-mcp/openapi.html
  ```

- `tsconfig.json`（node の型あり）はエディタとテストのためのもの。`tsconfig.lib.json` は、テストでない `src/` を ambient な型なしで確かめる。そのため、Workers・DOM・node に頼ると `pnpm run tsc` が落ちる

## D1 のスキーマ

`apps/api/src/db` に、Better Auth のテーブル、`question_sets`、`questions`、`host_allowlist` の drizzle のテーブルを置く。`createDb(env.DB)` で使う。

- `schema/auth.ts` は Better Auth の CLI（`auth`、前の名前は `@better-auth/cli`）が出力したもの。CLI には設定ファイルが要る。Better Auth を上げたときやプラグインを足したときに作り直す。`account` に手で足した `(provider_id, account_id)` の unique は残す。Better Auth は、重なった行のあるアカウントを引くのを断るため
- `questions.choices` は JSON の配列の列。DB の CHECK 制約は、protocol の `questionSchema` の決まり（選択肢は2〜4個で、どれも文字列、正解の番号が範囲内、F9 の上限）を写したもので、数は protocol の定数から取る
- `migrations/` は生成したもの。次で作り、SQL を手で直さない。oxfmt は `migrations/meta` を飛ばす。デプロイしたマイグレーションには新しいものを足すだけにし、古いコードでも動くように、足すだけの変更にする（[ADR 0005](../adr/0005-infrastructure-management.md)）

  ```sh
  pnpm --filter @zubatto-quiz/api run db:generate --name <name>
  ```

- 次で、`vite dev` が使う手元の D1（`apps/web/.wrangler/state`）に当てる

  ```sh
  pnpm --filter @zubatto-quiz/api run db:migrate:local
  ```

- テストでは、`test/apply-migrations.ts` がテストのファイルごとに `migrations/` を当てる。vitest-plugin はテストの間で D1 を空にしないので、`beforeEach` でテーブルを空にする。drizzle は D1 のエラーを包むので、`cause.message` で確かめる

## 部屋の DO の SQLite

`apps/api/src/room` では drizzle を使わず、`ctx.storage.sql` をそのまま使う。こうして `join` の確かめと行の追加を同期のままにする。

- `schema.ts` の `ROOM_MIGRATIONS` に、版ごとに1つの SQL の文字列を置く。コンストラクタが `blockConcurrencyWhile` の中で `migrate` を動かし、各版とその `schema_migrations` の行を1つの `transactionSync` で当てる。デプロイした版は直さず、新しい版を後ろに足す
- DO の SQLite は `PRAGMA user_version` に対応していない（2026-10-12 に確かめた）。そのため版は `schema_migrations` に持つ
- テーブルは `STRICT` にする。`participants.join_order` は rowid の別名で、採点の `joinOrder` になる。参加で書くのは `participants` の行だけ（ADR 0004 の DD7）で、合計の得点は `sum(question_scores.points)`。`questions.closed_at` は締切の採点が済んだ問題の印で、alarm がもう一度動いてもその問題は飛ばす（A3）
- 値は `?` で渡す。数も含めて、文字列に埋め込まない
- `attachment.ts` に `Attachment`（`host` / `player` / `null` = 未確認）と、`getAttachment`・`setAttachment` を置く

## 採点の関数

`packages/scoring` に、F11・F14・F15 の純粋な関数を置く。部屋の DO は結果を保存して配るだけで、点や順位を自分では計算しない。

- 配点は `config.ts` だけで変える（M2）。`defaultScoring` には F12 の `quickBonus`（1.00秒以内、1.00秒ちょうどを含む、+200点）が入っているので、`maxPointsPerQuestion` と F15 の `remainingMaxPoints` は1問1,200点になる。`quickBonusPoints` は `scoreAnswer` のうちのボーナスの部分。要件定義書の表のボーナスなしの列が要るテストは、`{ basePoints: 500, maxSpeedPoints: 500 }` を渡す
- 経過時間は `normalizeElapsedMs` で1回だけ正規化し、その値を表示・得点・ボーナス・最速の回答に使う（P2）
- 同点のときの決め方は、要件定義書の[「同点のとき」](../requirements/zubatto-quiz.md#同点のとき)にある。`positionOf` は protocol の `playerPosition` の形から `rankUp` と `hidden` を除いたものを返し、締切の集計がそれを足す
- `packages/protocol` と同じく、`tsconfig.lib.json` がテストでない `src/` を ambient な型なしで確かめる
