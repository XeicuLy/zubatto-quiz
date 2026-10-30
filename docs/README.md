# ドキュメントの入口

ズバクイの文書がどこにあり、何から読めばよいかをまとめる。文書の中に出てくる ID や番号の意味は、下の「用語集」で引く。

## 文書の地図

| 場所                                                                                                                   | 中身                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [README.md](../README.md)                                                                                              | ズバクイが何か、開発環境と本番の環境の作り方、手順書の一覧                                       |
| [requirements/zubatto-quiz.md](requirements/zubatto-quiz.md)                                                           | 要件定義書。要件の ID（`F*`・`P*` など）と、スコアの計算はここで決める                           |
| [adr/](#adr-の一覧)                                                                                                    | 技術の判断の記録（ADR）。下の一覧から開く                                                        |
| [design/README.md](design/README.md)                                                                                   | 画面のデザインモックと、1問の流れ（①②③）                                                         |
| [runbooks/](../README.md#運用の手順書)                                                                                 | コードで表せないものの手順書。本番を作る・出す・止める・ログを見る                               |
| [rehearsal/o2-rehearsal.md](rehearsal/o2-rehearsal.md)                                                                 | 本番の環境で行った O2 のリハーサルの記録と、使用量                                               |
| [CONTRIBUTING.md](../CONTRIBUTING.md)                                                                                  | コントリビュートの方針、PR の題名とコミットメッセージの形                                        |
| [CLAUDE.md](../CLAUDE.md)                                                                                              | コードを書くときに守る約束とコマンド。Claude Code が読むが、人が読んでもよい                     |
| [plan.md](../plan.md)                                                                                                  | 最初の大まかな案。要件定義書や ADR と食い違うところは、そちらが正しい                            |
| [ws.schema.json](../packages/protocol/schema/ws.schema.json)・[openapi.json](../packages/protocol/schema/openapi.json) | WebSocket のメッセージと HTTP API の形。`packages/protocol` の zod から作る。Go へ移すときの正本 |
| [CHANGELOG.md](../CHANGELOG.md)                                                                                        | 版ごとの変更。release-please が書く（ADR 0009）                                                  |
| [tools/docs-check/](../tools/docs-check/)                                                                              | 文書のリンク・コマンド・設定が、リポジトリの今の形とずれていないかを確かめるテスト               |

## 最初に読む順番

### 初めて知る人

1. [README.md](../README.md) で、ズバクイが何で、どこで動くかをつかむ
2. [要件定義書](requirements/zubatto-quiz.md)の「機能要件」と「スコアの計算」で、何ができて、点がどう決まるかを知る
3. [ADR 0001](adr/0001-backend-runtime-and-realtime-transport.md) で、部屋ごとの Durable Object と WebSocket を選んだ理由を読む
4. [ADR 0006](adr/0006-spa-and-api-worker-layout.md) で、画面の Worker と API の Worker の分け方を読む
5. [design/README.md](design/README.md) の「1問の流れ」で、出題から ①②③ までの画面の進み方を見る

### 開発に加わる人

1. [CONTRIBUTING.md](../CONTRIBUTING.md) で、進め方と PR の題名の形を知る
2. [README.md の「開発環境を作る」](../README.md#開発環境を作る)のとおりに、手元で動かす
3. [CLAUDE.md](../CLAUDE.md) で、触る場所の約束を読む。破ると安全（S1〜S4）や同時に起きる処理の正しさが崩れるものが多い
4. 触る場所に関わる ADR を、下の一覧から読む。部屋と WebSocket なら 0001・0003・0004、問題セットなら 0002、画面なら 0006・0007、CI とリリースなら 0005・0009・0010
5. メッセージや HTTP API の形を変えるときは、[ws.schema.json](../packages/protocol/schema/ws.schema.json) と [openapi.json](../packages/protocol/schema/openapi.json) も作り直す（作り方は CLAUDE.md にある）

### 本番を運用する人

1. [README.md の「本番の環境を一から作る」](../README.md#本番の環境を一から作る)で、本番が何からできているかを知る
2. [release.md](runbooks/release.md) と [deploy.md](runbooks/deploy.md) で、版の出し方と本番へのデプロイを読む。本番の最中は API の Worker をデプロイしない
3. [stop-and-usage.md](runbooks/stop-and-usage.md) で、本番の前後の使用量の確かめ方と、すぐに止める方法を読む
4. [logs.md](runbooks/logs.md) で、本番中と本番のあとのログの見方と残し方を読む
5. 本番の前に、[tools/loadtest/README.md](../tools/loadtest/README.md) でリハーサルを行う。前の結果は [o2-rehearsal.md](rehearsal/o2-rehearsal.md) にある

## ADR の一覧

状態は各 ADR の Status と同じ言葉で書く。`accepted` は決まって、今もそのとおりに作っているもの。

| 番号                                                        | 決めたこと                                                                                                    | 状態                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [0001](adr/0001-backend-runtime-and-realtime-transport.md)  | バックエンドは Hono と Cloudflare Workers・Durable Objects で WebSocket を使い、あとで Go と Cloud Run へ移す | accepted                                                       |
| [0002](adr/0002-question-set-storage-and-room-handoff.md)   | 問題セットは D1 に持ち主ごとに置き、部屋を作るときに部屋の DO へ写す                                          | accepted                                                       |
| [0003](adr/0003-host-identification-and-host-connection.md) | ホストは GitHub ログインと許可リストで見分け、進行操作はホスト用の入口の接続からだけ受け付ける                | accepted                                                       |
| [0004](adr/0004-player-identification-and-reconnection.md)  | 回答者は participantId と端末が作る秘密で見分け、秘密は localStorage に置いて最初のメッセージで送る           | accepted                                                       |
| [0005](adr/0005-infrastructure-management.md)               | インフラは wrangler の設定ファイルで管理し、Terraform は Go へ移すときに入れる                                | accepted（デプロイを動かすきっかけを ADR 0010 で変えた）       |
| [0006](adr/0006-spa-and-api-worker-layout.md)               | 画面の Worker と API の Worker に分け、`/api/*` を Service binding で転送して同じオリジンにする               | accepted                                                       |
| [0007](adr/0007-ui-components-approach.md)                  | UI 部品は shadcn/ui の Base UI 版で作り、役割トークンは shadcn の名前にそろえる                               | accepted                                                       |
| 0008                                                        | Go を Cloud Run に移すか、Cloudflare に残すか。#146 で書く                                                    | 予約                                                           |
| [0009](adr/0009-release-versioning-and-tagging.md)          | 版と CHANGELOG は release-please のリリース PR で決め、本番には承認してからデプロイする                       | accepted（タグのルールセットと承認の回数を ADR 0010 で変えた） |
| [0010](adr/0010-deploy-on-release.md)                       | 本番のデプロイは Release をきっかけに動かし、タグのコミットを1回の承認で出す                                  | accepted                                                       |

## 用語集

### 要件の ID

[要件定義書](requirements/zubatto-quiz.md)で決める。ADR・コミット・コードのコメントは、この ID で要件を引く。

| 頭文字 | 意味                                                              | 例                                                       |
| ------ | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `F`    | [機能要件](requirements/zubatto-quiz.md#機能要件)                 | F12: 1.00秒以内に正解すると早押しボーナス（+200点）      |
| `P`    | [パフォーマンス](requirements/zubatto-quiz.md#パフォーマンス)     | P1: ホストの操作から全員の画面が変わるまで1秒以内        |
| `S`    | [セキュリティ](requirements/zubatto-quiz.md#セキュリティ)         | S2: 正解は締切まで回答者の端末に送らない                 |
| `A`    | [可用性](requirements/zubatto-quiz.md#可用性)                     | A3: 障害が起きても、締切まで終わった問題の得点は消えない |
| `SC`   | [スケーラビリティ](requirements/zubatto-quiz.md#スケーラビリティ) | SC1: 1部屋に50名まで                                     |
| `M`    | [保守性・拡張性](requirements/zubatto-quiz.md#保守性拡張性)       | M2: 配点は設定値を変えるだけで変えられる                 |
| `C`    | [コスト](requirements/zubatto-quiz.md#コスト)                     | C1: 基本は無料枠の中で動かす                             |
| `O`    | [運用・監視](requirements/zubatto-quiz.md#運用監視)               | O2: 本番の前に、同時参加を再現してリハーサルできる       |

### DD と、ADR の選択肢の ID

- `DD1`・`DD2`…は、ADR の Decision Drivers（判断の基準）の番号。ADR ごとに付けるので、ADR 0003 の DD2 と ADR 0004 の DD2 は別のもの
- ADR 0001 だけは、DD ができる前に書いたので `D1`〜`D6` を使う。「ADR 0001 の D5」はロックイン耐性の基準で、データベースの Cloudflare D1 とは関係ない
- `J1`・`K1`・`R1`・`X1` などは、ADR の Considered Options（比べた選択肢）の ID。これも ADR ごとに付けるので、同じ文字でも ADR が違えば別のもの。要件の頭文字（`F`・`P`・`S`・`A`・`SC`・`M`・`C`・`O`）は使わない

### X1

[ADR 0004](adr/0004-player-identification-and-reconnection.md) の軸X（同じ回答者が同時に2つつながったとき）の選択肢で、「新しい接続を優先し、古い接続は理由付きで閉じる」こと。別のタブで同じ部屋を開くと、先に開いていたタブの接続は close code 4301（`replaced`）で閉じ、そのタブはつなぎ直さない。

### T 番号

`T1`〜`T51` は、実装を GitHub の Issue に分けたときのタスクの番号。Issue の番号とは別に付けた。#108 からあとの Issue には T 番号はない。

- T1〜T37 と T39〜T43 は、Issue の番号が T 番号に4を足したもの（T24 は #28、T40 は #44）
- T38 は2つある。MVP（#2）のほうはデプロイの workflow の #53、SHOULD（#3）のほうは F12 の早押しボーナスの #42。文書に Issue の番号が添えてあれば（ADR 0005 の「T38（#53）」）そちら、なければ話の中身で見分ける（要件定義書の「F12 を作ったとき（T38）」は #42）
- T44〜T51 は、あとから MVP に足したもので、次のとおり

| T 番号 | Issue | 中身                                                            |
| ------ | ----- | --------------------------------------------------------------- |
| T38    | #42   | F12 の早押しボーナス（SHOULD）                                  |
| T38    | #53   | 本番のデプロイの workflow（MVP）                                |
| T44    | #65   | HTTP API の OpenAPI を protocol の zod から作る                 |
| T45    | #69   | ホストの接続が未確認の接続に締め出されないよう、上限を見直す    |
| T46    | #73   | ホストに hostReady を送り、つなぎ直した端末に今の段階を送り直す |
| T47    | #80   | 回答者のつなぎ直しまわりの E2E                                  |
| T48    | #86   | ホストの待機画面の QR コード                                    |
| T49    | #87   | ない部屋・他人の部屋を専用の close code で閉じる                |
| T50    | #97   | 部屋が終わったあとの画面の文言                                  |
| T51    | #98   | 回答者の IP アドレスがログに残ることと S5 の折り合い            |

[ADR 0004](adr/0004-player-identification-and-reconnection.md) の「Considered Options」とそれを比べる節に出てくる `T1`〜`T5` は、タスクではなく軸T（秘密をどう送るか）の選択肢。たとえば T2 は「接続したあとの最初のメッセージで送る」こと。同じ ADR でも Consequences の T9・T20・T21 などはタスクの番号。

### ①②③

[1問の流れ](design/README.md#1問の流れ)で、締切のあとにホストが押すたびに1段ずつ出す画面。

| 記号 | 画面             | 中身                                                                                                      |
| ---- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| ①    | 正解と回答の分布 | 正解と、選択肢ごとの人数。回答者には自分の○×と得点、自分の位置を出す（自分の位置は最後の2問では出さない） |
| ②    | 最速正解の発表   | 最速の3人と秒数、正解した人数、この問題で一番順位を上げた人（一番順位を上げた人は最後の2問では出さない）  |
| ③    | 途中経過         | 上位10人。ホストが出したいときだけ出す。最後の2問では出せない（順位を最後まで伏せる）                     |
