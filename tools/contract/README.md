# 契約テスト

サーバーの外から、送ってくるものが仕様のとおりかを確かめる。仕様は protocol が書き出した2つのファイルで、Go に書き直すときの正でもある（ADR 0001・0008）。

| ファイル                                                        | 調べるもの                                                |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| [ws.schema.json](../../packages/protocol/schema/ws.schema.json) | WebSocket でサーバーが送るメッセージ（`ServerMessage`）   |
| [openapi.json](../../packages/protocol/schema/openapi.json)     | HTTP の応答（経路と状態コードごとの content-type と本文） |

今の TypeScript のサーバーでも Go のサーバーでも、同じテストがそのまま通れば、画面を触らずに差し替えられると言える。

## しくみ

- `src/validate.ts`: 2つのファイルを [ajv](https://ajv.js.org/) で読んで調べる部品。protocol の TypeScript（zod）は import しない。zod から書き出したものを zod で確かめると、zod のずれを見逃すため
  - `validateServerMessage(message)`: `JSON.parse` したメッセージを `ServerMessage` で調べる。`type` が同じ形とだけ比べるので、エラーには合わないところだけが出る
  - `validateResponse('POST /api/rooms', response)`: `fetch` の応答を、openapi.json に書いた経路と状態コードの応答で調べ、読んだ本文を返す（204 は `undefined`）。経路は openapi.json のキー（`'GET /api/question-sets/{id}'`）をそのまま書く。書いていない状態コードや content-type もエラーにする
- `format`（uuid・date-time・uri）は ajv-formats で確かめる。uuid と date-time は zod が `pattern` も書き出すが、参加用の URL（`joinUrl`）の uri は `format` でしか捕まらない
- `src/client.ts`: サーバーにつなぐ部品。受け取ったものはすべて `validate.ts` で調べる
  - `loginAsHost(origin)`: テスト用のログイン（`POST /api/e2e/login`）で新しいホストになり、Cookie ヘッダーの値を返す
  - `request(session, 'PUT /api/question-sets/{id}', { params, body })`: openapi.json のキーをそのまま URL のひな形にして送り、応答を `validateResponse` で調べて `{ status, body }` を返す。`{ origin }` だけを渡すと、Cookie を付けずに、ログインしていない人として送る
  - `ContractSocket`: 部屋の WebSocket。届いたメッセージをすべて `validateServerMessage` で調べてためる。合わないものが1つでも届いたら、`waitFor` はすぐその理由で失敗する（数えて捨てると、最初のずれがほかの待ちの時間切れに埋もれる）。閉じたときの code を返す `closed` も、それまでに合わないものが届いていれば失敗するので、最後の `waitFor` のあとに届いたものも見逃さない。`messages` は届いた順のメッセージを返す
  - `handshakeStatus(url, headers)`: WebSocket の握手を node:http で1つ送り、状態コードを返す（受け付けられたら 101 で、すぐ閉じる）。Node の WebSocket は断られたときの状態コードを見せず、Origin のない握手も作れないため。応答を返さずに切られたら `null` を返す

## シナリオ

`test/*.contract.test.ts` はサーバーにつないで動く。環境変数 `CONTRACT_ORIGIN` があるときだけ動き、ないときは飛ばすので、`make check` はオフラインのまま走る。

| ファイル                                                      | 確かめること                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [full-game.contract.test.ts](test/full-game.contract.test.ts) | ホストと2人で3問を通す。問題セットの作る・一覧・読む・変える・消すと部屋を作るの成功の応答、届いたすべてのメッセージがスキーマに合うこと、ホストと回答者に届く type の種類、正解したかどうかと最終順位、`endRoom` で全員が 4410 で閉じること                                                                                                                                                                                                                       |
| [security.contract.test.ts](test/security.contract.test.ts)   | 安全の約束。S1: 他のホストの部屋は 4404 で閉じ、問題セットは読む・変える・消す・部屋を作るのどれも 404 で、ない ID と見分けがつかない。S2: 受付中につなぎ直したホストと回答者を含め、締切の前に届いたどのメッセージにも `correctIndex` がない。X1: 同じ秘密で `resume` すると、古い接続だけが 4301 で閉じる。未確認の接続は、回答も進行操作も `not_verified` で返され、全員へのメッセージも届かない。Origin のない・違う握手は受け付けず、Upgrade のない要求は 403 |

点数と時間は、答えるまでの時間で変わるので値を比べない。形だけをスキーマで調べる。

### サーバーに求めること

Go のサーバーで走らせるときも、次の2つが要る。

- テスト用のログイン `POST /api/e2e/login`: 呼ぶたびに新しいホストを作り、`{ "cookies": [{ "name": "…", "value": "…" }] }` を返す。openapi.json には書かない、テストの環境だけの経路（TS のサーバーでは [e2e-entry.ts](../../apps/api/test/e2e-entry.ts)）
- 画面と API が同じオリジンにあること。`Origin` に `CONTRACT_ORIGIN` を付けて送る
- 部屋の入口では、Origin を Upgrade より先に確かめること。Upgrade のない要求でも、Origin が違えば 426 ではなく 403 を返す。vite preview（`@cloudflare/vite-plugin` 1.63.1）は Worker が返した 101 でない応答を握手の相手へ返さずに接続を切るので、状態コードはこの要求で確かめる（2026-11-03 に確かめた）

### 外から確かめられない約束

次の約束は、閉じたときの code・届いたメッセージ・状態コードには出ないので、契約テストでは確かめない。Go に書き直すときは、それぞれのサーバーのテストで守る。

- 回答者の秘密を SHA-256 で持ち、`timingSafeEqual` で比べること（持ち方と比べ方）
- 秘密を URL やログに出さないこと（ログは外から読めない。ログに残るものは [logs.md](../../docs/runbooks/logs.md#ログに残るもの残らないもの)）
- 正解の番号を読む場所を、採点と結果を作る関数だけにすること。結果を保存せず、決まった数のクエリで作り直すこと（P4）
- 接続の本数の上限（回答者100本・ホスト5本）を、受け付ける前に数えること。上限の数は外から見えるが、同時に来たときに超えないことは、外からは確かめにくい
- 1問に1回だけ答えられることを、同時に送ったときも守ること（同じく、競り合いは外から起こしにくい）
- 部屋の ID を推測できない形で作ること（S3）。形は openapi.json で調べるが、推測できないかは調べられない
- 眠った部屋や立ち上げ直した部屋が、同じ状態から続けること（TS では `evictDurableObject` で確かめる）

## 手元で試す

部品の単体テストはサーバーなしで走り、`make check` にも入っている。

```sh
pnpm exec vitest run --project contract
```

シナリオは、本番に近いビルド（E2E と同じ）を立ち上げてから、`CONTRACT_ORIGIN` を付けて走らせる。

```sh
# ターミナル1: 立ち上げたままにする（止めるまで戻ってこない）
pnpm --filter @zubatto-quiz/web run e2e:serve

# ターミナル2: 1の /api/health が返るようになってから走らせる
CONTRACT_ORIGIN=http://localhost:4173 pnpm exec vitest run --project contract
```

`e2e:serve` は立ち上がるたびに D1 と部屋を空にする。前のサーバーを止めずに2つ目を立ち上げると、2つ目はポートが使われていて止まるが、その前に動いている1つ目の D1 を消すので、ログインが 500 を返すようになる。立ち上げ直すときは、先に止める。シナリオは毎回新しいホストでログインするので、続けて何度走らせてもよい。
