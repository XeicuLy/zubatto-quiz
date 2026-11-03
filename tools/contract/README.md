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

## 手元で試す

部品の単体テストはサーバーなしで走り、`make check` にも入っている。

```sh
pnpm exec vitest run --project contract
```

サーバーにつないで1ゲームを通すシナリオは、これから足す。環境変数 `CONTRACT_ORIGIN` があるときだけ動き、ないときは飛ばすので、`make check` はオフラインのまま走る。
