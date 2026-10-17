# O2 のリハーサル用のボット

本番の前に、1人で20名分（O2）や5部屋 × 50接続（ADR 0001）の同時参加を再現する。ボットに最後まで遊ばせ、次のものを表にする。

| 行                  | 測るもの                                                                      | 目標                     |
| ------------------- | ----------------------------------------------------------------------------- | ------------------------ |
| P1 出題             | ホスト役が `showQuestion` を送ってから、各ボットに `questionShown` が届くまで | 全員に届き、1秒以内      |
| P1 受付開始         | `startAnswering` を送ってから、各ボットに `answeringStarted` が届くまで       | 全員に届き、1秒以内      |
| P1 締切             | `closeAnswering` を送ってから、各ボットに `myResult`（① の結果）が届くまで    | 全員に届き、1秒以内      |
| P4 締切から結果     | `closeAnswering` を送ってから、ホストに `revealed` が届くまで（結果を出せる） | 2秒以内                  |
| P3 回答の取りこぼし | ボットが答える予定だった数と、`answerAccepted` が届いた数                     | 予定した回答がすべて受理 |

時間はどれも、同じプロセスの中で「ホスト役が送った時刻」と「受け取った時刻」の差を `performance.now()` で測る。手元の回線の往復も含むので、会場の回線で測ると本番に近くなる。

## しくみ

- `src/run.ts`: リハーサル用の問題セット（N問・4択）を作って部屋を作り、部屋を作り終えたらセットを消す。部屋の DO は問題を写し終えているので、消しても遊べる（ADR 0002）
- `src/bot.ts`: 回答者の入口につないで `join` し、受付開始が届いたらランダムな選択肢で答える
- `src/host.ts`: ホストの入口につなぎ、出題 → 受付開始 → 締切 → ② →（③）→ … → 最終ランキング → 部屋を終える、まで進める
  - ③ は、画面と同じく `canShowStandings` で出せる問題でだけ出す
  - 締切は、全員の回答がそろったら（`answerProgress`）、そろわなくても制限時間が来たら送る。先に部屋の DO の alarm が締め切ったときは、その問題の締切は測らず、表の下に書く
- `src/connection.ts`: 受け取ったメッセージは protocol の `serverMessageSchema` で読み、送るものは `clientMessageSchema` に通す。メッセージ仕様が変わると、ボットも型チェックで一緒に落ちる（ADR 0001）
- `src/metrics.ts`: 集計と表。届かなかったメッセージは10秒で打ち切って「48 / 50 件」のように数え、件数が足りなければ「満たしていない」にする

Node の組み込みの `WebSocket` は、ブラウザと違って `Origin` と `Cookie` のヘッダーを付けられる。API は `Origin` が画面の Worker と違う WebSocket を断る（ADR 0003・0004）ので、ボットは `--origin` と同じ値を付ける。

## 秘密の扱い

- ボットの秘密（再接続用の32バイト）は、ボットのメモリにだけ持つ。ログにも表にも出さない（ADR 0004）
- ホストのセッションの Cookie は、引数ではなく環境変数 `ZUBAKUI_HOST_COOKIE` で渡す。引数はシェルの履歴とプロセスの一覧に残るため。スクリプトも Cookie をログに出さない
- 部屋の ID は参加用の URL になるので、ログには「部屋1」のような名前だけを出す（S3）

## 手元で試す

E2E と同じビルド（`http://localhost:4173`）に向けて走らせる。テスト専用のログインの入口（`/api/e2e/login`）で Cookie を取れるので、GitHub は通らない。

```sh
# 1つ目のターミナル（毎回 D1 と DO を空から始める）
pnpm --filter @zubatto-quiz/web run e2e:serve

# 2つ目のターミナル
export ZUBAKUI_HOST_COOKIE=$(curl -s -X POST http://localhost:4173/api/e2e/login \
  | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).cookies.map((c)=>`${c.name}=${c.value}`).join("; ")))')
pnpm --filter loadtest start --origin http://localhost:4173 --rooms 1 --bots 20
```

## 本番で走らせる

1. 本番の画面（`https://<画面の Worker の URL>/login`）に、許可リストにいるホストとして GitHub でログインする
2. ブラウザの開発者ツールの「Application」→「Cookies」で、`__Secure-better-auth.session_token` の値をコピーする。名前の先頭の `__Secure-` は、`BETTER_AUTH_URL` が `https://` のときに付く（[secrets.md](../../docs/runbooks/secrets.md)）
3. 環境変数に入れて走らせる。値を貼るときは `read -rs` を使い、シェルの履歴に残さない

   ```sh
   read -rs 'COOKIE_VALUE?セッションの Cookie の値: '   # bash では read -rsp '…' COOKIE_VALUE
   export ZUBAKUI_HOST_COOKIE="__Secure-better-auth.session_token=${COOKIE_VALUE}"
   pnpm --filter loadtest start --origin https://<画面の Worker の URL> --burst > result.md
   unset ZUBAKUI_HOST_COOKIE COOKIE_VALUE
   ```

4. 終わったら、ホストの画面からログアウトして、セッションを終わらせる

本番の部屋は Workers と D1 の無料枠を使う。使用量の見方と、止め方は [stop-and-usage.md](../../docs/runbooks/stop-and-usage.md) にある。

## 引数

| 引数          | 初期値   | 意味                                                                                                          |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `--origin`    | （必須） | 画面の Worker のオリジン。`http://` か `https://`                                                             |
| `--rooms`     | 5        | 同時に開く部屋の数（SC2 は5部屋まで）                                                                         |
| `--bots`      | 50       | 1部屋のボットの数（SC1 の上限の50まで）                                                                       |
| `--questions` | 3        | 問題の数。3問以上なら、第1問で ③ 途中経過も出す                                                               |
| `--limit`     | 10       | 制限時間（秒、F9 の5〜60）                                                                                    |
| `--burst`     | なし     | 付けると、残りの 85〜90% のあいだに全員が答える（締切の直前の一斉回答、P3）。付けないときは 0〜90% にばらける |

表は標準出力に、途中の様子は標準エラーに出す。`> result.md` で表だけを残せるので、[O2 のリハーサルの記録](https://github.com/XeicuLy/zubatto-quiz/issues/41)にそのまま貼れる。どれかの行を満たさないときは、終了コードが1になる。
