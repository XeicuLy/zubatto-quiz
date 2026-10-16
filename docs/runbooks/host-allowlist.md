# ホストの許可リスト

ホストになれるのは、D1 の `host_allowlist` に GitHub のユーザー ID がある人だけ（S1・ADR 0003）。画面は作らず、`wrangler d1 execute` で足したり外したりする。

| 列               | 中身                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `github_user_id` | GitHub のユーザー ID。**数ではなく文字列**で入れる（`'12345'`）。GitHub のログイン名は変えられるので使わない |
| `note`           | 誰なのかのメモ。足すときに書く                                                                               |
| `created_at`     | 足した時刻。自動で入る                                                                                       |

許可リストは2か所で確かめている。

- 新しく登録するとき: GitHub から受け取ったプロフィールの ID で確かめる。許可リストにない人は、D1 に行が作られない
- ログインするたび（セッションを作るたび）: その人の GitHub の account が許可リストにあるかを確かめる。外した人は、次のログインで拒否される

## コマンドの場所

コマンドは `apps/api` で実行する。`DB` は `wrangler.jsonc` の D1 の binding の名前。

- 本番: `--remote` を付ける。先に `pnpm exec wrangler login` でログインしておく
- ローカル（`vite dev`）: `--remote` の代わりに `--local --persist-to ../web/.wrangler/state` を付ける

```sh
cd apps/api
pnpm exec wrangler d1 execute DB --remote --command "<SQL>"
pnpm exec wrangler d1 execute DB --local --persist-to ../web/.wrangler/state --command "<SQL>"
```

## GitHub のユーザー ID を調べる

```sh
gh api users/<GitHub のログイン名> --jq .id
```

## 足す

```sh
pnpm exec wrangler d1 execute DB --remote \
  --command "INSERT INTO host_allowlist (github_user_id, note) VALUES ('12345', 'alice')"
```

足した人は、`/login` から GitHub でログインすればホストになれる。

## 今のリストを見る

```sh
pnpm exec wrangler d1 execute DB --remote --command "SELECT * FROM host_allowlist"
```

## 外す（ホストの取り消し）

ホストをやめてもらうときは、次を**この順で**行う。先にセッションを消すと、許可リストから外すまでの間にログインし直せてしまう。

1. 許可リストから外す。これで次のログインから拒否される

   ```sh
   pnpm exec wrangler d1 execute DB --remote \
     --command "DELETE FROM host_allowlist WHERE github_user_id = '12345'"
   ```

2. その人のセッションを D1 から消す。セッションは7日有効で、使っていれば延びるので、消さないと、ログインしたままの画面から問題セットの編集や部屋の作成を続けられる。セッションの `user_id` は Better Auth の user の ID で、GitHub の ID ではないので、`account` から引く

   ```sh
   pnpm exec wrangler d1 execute DB --remote \
     --command "DELETE FROM session WHERE user_id IN (SELECT user_id FROM account WHERE provider_id = 'github' AND account_id = '12345')"
   ```

3. 消えたことを確かめる。両方とも結果が0行になる

   ```sh
   pnpm exec wrangler d1 execute DB --remote \
     --command "SELECT * FROM host_allowlist WHERE github_user_id = '12345'"
   pnpm exec wrangler d1 execute DB --remote \
     --command "SELECT s.id FROM session s JOIN account a ON a.user_id = s.user_id WHERE a.provider_id = 'github' AND a.account_id = '12345'"
   ```

### 外したあとも続くもの

- **つながったままのホスト用の WebSocket は、閉じるまで進行操作を続けられる。** 部屋の DO は、接続を開くときに1回だけホストかを確かめ、進行中は D1 に問い合わせないため（P1・ADR 0003）。その接続が閉じたあとは、つなぎ直せない
- user・account の行と、その人の問題セットは D1 に残る。もう一度許可リストに入れると、同じ GitHub のアカウントでログインすれば、前の問題セットがそのまま使える

### すぐに止めたいとき

開いている部屋の進行も今すぐ止めたいときは、次のどちらかにする。

- その部屋を終えてもらう。進行画面から部屋を終えると、その部屋のすべての接続が閉じる
- Worker を消す。すべての部屋が止まる（[stop-and-usage.md](stop-and-usage.md#止める)）
