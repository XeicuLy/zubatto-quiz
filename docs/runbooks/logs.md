# エラーのログ

本番中と本番のあとに、エラーのログを見られるようにする。少なくとも7日は残す（O1）。残し方は ADR 0005 で決めた2つで、どちらも Free プランのままで費用はかからない。

| 残し方                                 | 何が見えるか                                                        | どのくらい残るか                                     |
| -------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| Workers Logs（ダッシュボード）         | 2つの Worker の呼び出しごとのログ、エラー、捕まえていない例外       | 2026-11-30 までは3日。2026-12-01 からは7日（下の注） |
| `wrangler tail` を手元のファイルに残す | 同じもの。ただし、動かしている間のものだけ。混むと間引かれる（注2） | 最後に記録してから7日。そのあと消す                  |

- 部屋の DO のログは、API の Worker（`zubakui-api`）のログに入る
- アプリは自分ではログを出していない（`console.log` などを使っていない）。見えるのは、呼び出しごとのログと、Hono が 500 を返したときに出すエラーと、捕まえていない例外
- 注: 2026-12-01 から Workers Logs の料金と上限が変わる。Free では、取り込みが1日 0.5 GB まで（アカウント全体）で、7日残る。0.5 GB に達すると、課金はされず、0:00 UTC（日本時間 9:00）まで新しいログを取り込まない。本番の量は数千件で、上限よりずっと少ない見込み（ADR 0005、2026-10-11 に確かめた）
- 注2: `wrangler tail` は、呼び出しが多いと一部を捨てる（sampling mode）。捨てたときは、その旨の警告が出力に入る

## ダッシュボードで見る

1. ダッシュボードの **Workers & Pages** を開き、`zubakui-api`（または `zubakui-web`）を選ぶ
2. **Observability** を開く。呼び出しごとのログが新しい順に並ぶ
3. エラーだけに絞るときは、次のどちらかで絞り込む
   - `$metadata.error EXISTS`: エラーのあったログ
   - `$workers.outcome = "exception"`: 捕まえていない例外で終わった呼び出し

2026-10-18 に Cloudflare のドキュメント（Workers Logs と Errors and exceptions のページ）で確かめた。

## 本番中に手元のファイルに残す

12月からの料金の変更が遅れたときや、上限で取り込みが止まったときの予備。本番が始まる前に、リポジトリのいちばん上で、2つのターミナルで1つずつ動かしておく。

```sh
mkdir -p logs
pnpm -s run logs:api >> "logs/api-$(date +%Y%m%d-%H%M%S).json"
pnpm -s run logs:web >> "logs/web-$(date +%Y%m%d-%H%M%S).json"
```

- 先に `pnpm exec wrangler login` でログインしておく（`apps/api` で）
- `-s`（`--silent`）を付け、pnpm 自身の出力をファイルに混ぜない。`logs:api`・`logs:web` は中で pnpm をもう一度呼ぶので、そちらにも `--silent` を付けてある。pnpm 12.11.0 では、実行するコマンドの行（`$ wrangler tail ...`）は標準エラーに出て、ファイルには入らなかった（2026-10-18 に確かめた）
- 中身は `wrangler tail --format json` の出力で、1件の呼び出しが1つの JSON になって並ぶ。接続が切れたときは、wrangler がつなぎ直す
- `>>`（追記）で書く。`>` は同じ名前のファイルを空にしてから書くので、止まった tail を動かし直したときに名前がぶつかると、前のログが消える。ファイル名に秒まで入れるのは、1回の実行を1つのファイルにして読みやすくするため
- 本番が終わったら Ctrl+C で止める
- `logs/` は `.gitignore` に入っている。リポジトリには入れない
- **最後に記録してから7日たつまでは消さない**（O1）。2026-11-30 までは Workers Logs が3日で消えるので、4〜7日目のログはこのファイルにしかない。7日たったら消す

エラーを探すときは、`"outcome": "exception"` や `"level": "error"` で探す。

```sh
grep -n '"outcome": "exception"' logs/api-*.json
```

- WebSocket の入口（`/api/rooms/<部屋>/ws/play` など）の `"outcome": "canceled"` は、開いていた接続が端末の側から切れたときにも付く。`exceptions` が空なら、エラーではない（2026-10-18 の通しの確認で、例外のない `canceled` だけが出た）
- 部屋の DO の呼び出しは、`event` に `request` がなく、WebSocket のメッセージ（`getWebSocketEvent`）・alarm（`scheduledTime`）・RPC（`rpcMethod`）として並ぶ

## ログに残るもの・残らないもの

ログに秘密を残さないよう、次のようにしている（ADR 0004・0005、S5）。

| もの                                                                        | ログでは                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| URL の経路とメソッド                                                        | 残る（`GET /api/question-sets` など）                              |
| URL のクエリ（GitHub から戻る URL の `code`・`state`）                      | 残らない（`wrangler.jsonc` の `redact_query_string`）              |
| `cookie`・`set-cookie` と、名前に `auth`・`key`・`secret`・`token` を含む値 | `REDACTED` になる。ヘッダーがあったことだけが分かる                |
| WebSocket のメッセージの本文（`join`・`resume` の秘密、回答者の名前、回答） | 残らない。WebSocket は、イベントの種類（`message` など）だけが残る |

- 接続元の IP アドレス（`cf-connecting-ip`・`x-real-ip`）と国（`cf-ipcountry`）は、Workers Logs（`$workers.event.request.headers.cf-connecting-ip`）にも `wrangler tail` の出力にも残る。回答者のものも残る（2026-10-18 に確かめた）
- `wrangler tail` の出力でも、Cookie などのヘッダーの値は `REDACTED` になり、`redact_query_string` で URL のクエリも消える（GitHub から戻る要求で、2026-10-18 に確かめた）。それでも IP アドレスが残るので、手元のファイルを人に渡したり、どこかに貼ったりしない
- アプリにログを足すときは、`{ event: 'join_rejected', roomId, code }` のように決まったキーの値だけを出す。秘密とそのハッシュ、メッセージの本文、回答者の名前、Cookie やセッションの値は出さない（ADR 0005）

## 本番のあとに

本番が終わったら、その日のうちに次を行う。

1. ダッシュボードで、本番の時間帯に `$metadata.error EXISTS` で絞り、エラーがないかを見る
2. エラーがあれば、手元のファイルにも同じものがあるかを見て、どの操作のときに起きたかを書き留める
3. 使用量を控える（[stop-and-usage.md](stop-and-usage.md#本番の前後に確かめる)）
