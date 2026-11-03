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
  - `request(session, 'PUT /api/question-sets/{id}', { params, body })`: openapi.json のキーをそのまま URL のひな形にして送り、応答を `validateResponse` で調べて `{ status, body }` を返す
  - `ContractSocket`: 部屋の WebSocket。届いたメッセージをすべて `validateServerMessage` で調べてためる。合わないものが1つでも届いたら、`waitFor` はすぐその理由で失敗する（数えて捨てると、最初のずれがほかの待ちの時間切れに埋もれる）

## シナリオ

`test/*.contract.test.ts` はサーバーにつないで動く。環境変数 `CONTRACT_ORIGIN` があるときだけ動き、ないときは飛ばすので、`make check` はオフラインのまま走る。

| ファイル                                                      | 確かめること                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [full-game.contract.test.ts](test/full-game.contract.test.ts) | ホストと2人で3問を通す。問題セットの作る・一覧・読む・変える・消すと部屋を作るの成功の応答、届いたすべてのメッセージがスキーマに合うこと、ホストと回答者に届く type の種類、正解したかどうかと最終順位、`endRoom` で全員が 4410 で閉じること |

点数と時間は、答えるまでの時間で変わるので値を比べない。形だけをスキーマで調べる。

### サーバーに求めること

Go のサーバーで走らせるときも、次の2つが要る。

- テスト用のログイン `POST /api/e2e/login`: 呼ぶたびに新しいホストを作り、`{ "cookies": [{ "name": "…", "value": "…" }] }` を返す。openapi.json には書かない、テストの環境だけの経路（TS のサーバーでは [e2e-entry.ts](../../apps/api/test/e2e-entry.ts)）
- 画面と API が同じオリジンにあること。`Origin` に `CONTRACT_ORIGIN` を付けて送る

## 手元で試す

部品の単体テストはサーバーなしで走り、`make check` にも入っている。

```sh
pnpm exec vitest run --project contract
```

シナリオは、本番に近いビルド（E2E と同じ）を立ち上げてから、`CONTRACT_ORIGIN` を付けて走らせる。

```sh
pnpm --filter @zubatto-quiz/web run e2e:serve
CONTRACT_ORIGIN=http://localhost:4173 pnpm exec vitest run --project contract
```

`e2e:serve` は立ち上がるたびに D1 と部屋を空にする。シナリオは毎回新しいホストでログインするので、続けて何度走らせてもよい。
