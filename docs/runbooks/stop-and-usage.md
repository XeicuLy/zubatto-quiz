# 使用量の確かめ方と、止める手順

ズバクイは Cloudflare の無料プラン（Workers Free）で動かす。無料プランは、上限を超えると課金されずに止まる（C1・C3）。上限に近づいたことを知らせる公式の通知は見つからなかったので、本番の前後にダッシュボードで使用量を確かめる（C4・ADR 0005）。

有料プランに変えるときは、先に予算アラートを設定する（C4）。

## 無料プランの上限

2026-10-17 に Cloudflare のドキュメント（Workers・Durable Objects・D1 の料金と上限のページ）で確かめた。どれも毎日 0:00 UTC（日本時間 9:00）に戻る。

| 何の                                 | 上限（1日）                                      | 超えたら                                                            |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------- |
| Workers のリクエスト                 | 100,000（アカウント全体）                        | Error 1027 のページが返り、画面も API も使えない                    |
| Durable Objects のリクエスト         | 100,000（WebSocket のメッセージと alarm を含む） | 部屋の DO が使えなくなる                                            |
| Durable Objects の実行時間           | 13,000 GB-s                                      | 同上                                                                |
| Durable Objects の SQLite に書いた行 | 100,000                                          | 同上                                                                |
| D1 で読んだ行                        | 5,000,000                                        | D1 への問い合わせがエラーになる（ログイン・問題セット・部屋の作成） |
| D1 に書いた行                        | 100,000                                          | 同上                                                                |
| D1 の保存量                          | 5 GB（アカウント全体）                           | 同上                                                                |

本番の約2時間で上限に届くことは見込んでいない。届きそうかは、O2 のリハーサルで測った使用量で見積もる。

## 本番の前後に確かめる

本番の前（当日の朝など）と、終わったあとに、次を見て数を控える。前の数が大きいときは、その日のうちにほかで使っていないかを確かめる。

1. **Workers**: ダッシュボードの Workers & Pages で `zubakui-web` と `zubakui-api` をそれぞれ選び、Metrics でリクエスト数とエラーを見る
2. **Durable Objects**: ダッシュボードの Durable Objects のページで `RoomDurableObject` を選び、リクエスト数・実行時間・書いた行を見る
3. **D1**: ダッシュボードの D1 で `zubakui` を選び、Metrics → Row Metrics で読んだ行と書いた行を見る

エラーの中身は、Workers Logs（ダッシュボードの各 Worker の Logs）で見る（O1）。

## 止める

止めるときは Worker を消す（ADR 0001）。次の順に、画面の Worker から消す。API の Worker を先に消そうとすると、画面の Worker が Service binding で使っていると wrangler が警告し、それでも消すかを聞かれる。

```sh
cd apps/web
pnpm exec wrangler delete   # zubakui-web
cd ../api
pnpm exec wrangler delete   # zubakui-api
```

- 「Are you sure you want to delete ...? This action cannot be undone.」と聞かれるので `y` と答える
- ダッシュボードからも消せる。Workers & Pages で Worker を選び、Settings の Delete から消す
- 消したら、本番の URL を開いて、つながらないことを確かめる
- 止めている間は、デプロイの workflow を動かさない。動かすとまた動き出す

### 消えるものと残るもの

|                                      | どうなる                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 画面と API の Worker                 | 消える。開いていた WebSocket も切れ、回答者の端末はつなぎ直しを続けるが、つながらない             |
| シークレット                         | Worker と一緒に消える                                                                             |
| 部屋の DO（部屋・回答・得点）        | 戻せないものとして扱う                                                                            |
| D1（許可リスト・ホスト・問題セット） | 残る。`wrangler delete` は Worker だけを消す（wrangler 4.149.0 のソースで 2026-10-17 に確かめた） |

### また動かす

D1 は残っているので、作り直すのは Worker だけでよい。

1. シークレットを入れ直す（[secrets.md](secrets.md#本番-wrangler-secret-put)）
2. デプロイの workflow を動かす

### D1 も消すとき

ズバクイをやめるときだけ行う。許可リスト・ホスト・問題セットがすべて消え、戻せない。

```sh
cd apps/api
pnpm exec wrangler d1 delete zubakui
```
