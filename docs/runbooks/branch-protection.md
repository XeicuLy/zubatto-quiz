# main のルールセット

main ブランチは、リポジトリのルールセット（Settings → Rules → Rulesets）で守る。classic のブランチ保護（Settings → Branches）は使わない。CI が通らないと main にマージできないようにするためのもの（M1）。

設定の正本は [main-ruleset.json](main-ruleset.json) で、これを `gh api` に渡せば一から作り直せる。

## 何を決めているか

| 項目                                                 | 値                                                    | なぜ                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 対象                                                 | 既定のブランチ（`~DEFAULT_BRANCH`）                   | main の名前を変えても、そのまま効く                                                                                      |
| 削除の禁止（`deletion`）                             | あり                                                  | main を消せないようにする                                                                                                |
| force push の禁止（`non_fast_forward`）              | あり                                                  | main の履歴を書き換えられないようにする                                                                                  |
| PR 必須（`pull_request`）                            | 承認は0件                                             | 1人で開発しているので、承認は求めない。直接 push はできない                                                              |
| マージの方法                                         | merge と squash                                       |                                                                                                                          |
| CodeQL（`code_scanning`）                            | セキュリティの警告は high 以上、ほかは error で止める |                                                                                                                          |
| Code Quality（`code_quality`）                       | error で止める                                        |                                                                                                                          |
| 必須のステータスチェック（`required_status_checks`） | `ci`                                                  | CI の workflow（`.github/workflows/ci.yaml`）の job 名                                                                   |
| チェックを送ってよいアプリ（`integration_id`）       | `15368`                                               | GitHub Actions のアプリの ID。ほかの仕組みが同じ `ci` という名前で成功を送ってきても、必須のチェックの結果として使わない |
| strict（main に追いついていることを求める）          | なし                                                  | 1人で開発しているので、PR を出すたびに main を取り込み直す手間を省く                                                     |
| bypass                                               | なし                                                  | admin も例外にしない。CI が通らない PR は、誰もマージできない                                                            |

## 今の設定を見る

```sh
gh api repos/XeicuLy/zubatto-quiz/rulesets
gh api repos/XeicuLy/zubatto-quiz/rulesets/<id>
```

一覧の `id` を2つ目のコマンドに入れる。`main-ruleset.json` と見比べて、違っていたらどちらかを直す。

## 一から作り直す

リポジトリを作り直したときや、ルールセットを消してしまったときは、リポジトリのいちばん上で次を実行する。

```sh
gh api -X POST repos/XeicuLy/zubatto-quiz/rulesets --input docs/runbooks/main-ruleset.json
```

- `main-ruleset.json` には、`id`・`_links`・`created_at` など、GitHub が付ける項目を入れていない。入っていると作れないので、`gh api` で取り出した JSON から写すときは、これらを消す
- 作ったら、適当な PR で `ci` が必須のチェックとして表示され、通るまでマージのボタンが押せないことを確かめる

## 設定を変える

画面かコマンドで変えたら、`main-ruleset.json` も同じにそろえる。今の設定から、GitHub が付ける項目を除いて書き出せる。

```sh
gh api repos/XeicuLy/zubatto-quiz/rulesets/<id> \
  | jq '{name, target, enforcement, conditions, rules, bypass_actors}' > docs/runbooks/main-ruleset.json
pnpm run fmt   # jq の出力は oxfmt の形と違うので、整えないと fmt:check が落ちる
```

### CI の job 名を変えるとき

必須のチェックの名前は、job の表示名で決まる。表示名は `jobs.<job_id>.name` があればその値、なければ job ID（今は `ci`）になる。`ci.yaml` の job ID や `name:` だけを変えると、`ci` という名前のチェックがいつまでも来ないので、どの PR もマージできなくなる。job 名を変えるときは、同じ PR で次の両方を行う。

1. ルールセットの必須のチェックの名前を、新しい job 名に変える
2. `main-ruleset.json` の `context` も同じ名前にする

`main-ruleset.json` の名前が `ci.yaml` のどの job の表示名とも合わないと、`tools/docs-check` のテストが落ちる。テストは名前を決め打ちしていないので、テストを直す必要はない。

## CI が壊れて直せないとき

bypass がないので、CI が通らないと、CI を直す PR もマージできない。GitHub Actions の障害などで、どうしても通せないときだけ、ルールセットを一時的に止める。

```sh
# 止める
gh api -X PUT repos/XeicuLy/zubatto-quiz/rulesets/<id> -f enforcement=disabled
# PR をマージしたら、すぐに戻す
gh api -X PUT repos/XeicuLy/zubatto-quiz/rulesets/<id> -f enforcement=active
```

- 止めている間は、force push や main の削除も防げない。マージが終わったらすぐに戻す
- 戻したら、`gh api repos/XeicuLy/zubatto-quiz/rulesets/<id> --jq .enforcement` が `active` になっていることを確かめる
