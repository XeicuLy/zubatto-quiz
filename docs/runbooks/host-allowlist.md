# ホストの許可リスト

ホストになれるのは、D1 の `host_allowlist` に GitHub のユーザー ID がある人だけ（S1・ADR 0003）。許可リストの行には管理者の印（`is_admin`）もあり、管理者だけが通れる API の守りに使う（[ADR 0013](../adr/0013-host-admin-role.md)）。

管理者のホストは、管理者だけの API（`/api/admin/hosts`）で、GitHub の名前を入れてホストを足し、外せる。管理者の画面はこの API を呼ぶ。管理者の付け外しと、最初の管理者を入れることは、ここのコマンドだけで行う。

| 列               | 中身                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `github_user_id` | GitHub のユーザー ID。**数ではなく文字列**で入れる（`'12345'`）。GitHub のログイン名は変えられるので使わない  |
| `note`           | 誰なのかのメモ。足すときに書く                                                                                |
| `is_admin`       | 管理者の印。`1` が管理者、`0` が管理者でない。足すときに書かなければ `0` になる。付け外しはコマンドだけで行う |
| `created_at`     | 足した時刻。自動で入る。**書き換えない**（下の「ホストの要求のたび」の判定に使う）                            |

許可リストは4か所で確かめている。

- 新しく登録するとき: GitHub から受け取ったプロフィールの ID で確かめる。許可リストにない人は、D1 に行が作られない
- ログインするたび（セッションを作るたび）: その人の GitHub の account が許可リストにあるかを確かめる。外した人は、次のログインで拒否される
- ホストの要求のたび（`requireHost`）: その人の GitHub の account が許可リストにあり、セッションがその行の `created_at` より後に作られたかを確かめる。外した人は、ログインしたままの画面からでも、次の要求から 401 になる。行だけを外して足し直しても、外す前のセッションは通らない（足し直すと `created_at` が新しくなるため）。ホスト用の WebSocket は、つなぐときにだけ確かめる
- 管理者だけの API の要求のたび（`requireAdmin`）: その人の GitHub の account が、`is_admin` が `1` の行にあるかを確かめる。管理者でなければ 403 になる。キャッシュしないので、印を外せば次の要求から効く

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

### 画面から足す（管理者）

管理者は、足したい人の GitHub の名前（ログイン名）を入れるだけでよい。Worker が `api.github.com` に問い合わせて数値の ID に変え、許可リストに管理者でない行として入れる。足したときの名前は `note` にメモとして入る。

| 結果                     | 意味と、することは                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 足せた（201）            | 足した人に、`/login` から GitHub でログインしてもらう                                                                                                                                             |
| 見つからない（404）      | GitHub にその名前の個人のアカウントがない。綴りを確かめる。Organization の名前も、ここに入る                                                                                                      |
| すでにいる（409）        | 許可リストにすでにいる。何もしなくてよい                                                                                                                                                          |
| GitHub が答えない（502） | GitHub の上限（未認証は送り元の IP ごとに60回/時で、Workers の出口の IP はほかの利用者と共有している）か不調。時間をおいて入れ直す。何度入れ直しても通らなければ、ADR 0013 の対応事項（G2）へ進む |

### コマンドで足す

画面が使えないときや、名前ではなく ID で足したいときは、ID を調べてコマンドで入れる。

```sh
pnpm exec wrangler d1 execute DB --remote \
  --command "INSERT INTO host_allowlist (github_user_id, note) VALUES ('12345', 'alice')"
```

足した人は、`/login` から GitHub でログインすればホストになれる。

## 今のリストを見る

```sh
pnpm exec wrangler d1 execute DB --remote --command "SELECT * FROM host_allowlist"
```

## 管理者

管理者は、管理者だけの API（ホストの一覧・追加・外す）を使えるホスト。管理者は必ず許可リストにいる（印が許可リストの行にあるため）。画面からは管理者を増やせず、外すこともできない。付け外しは、ここのコマンドだけで行う（ADR 0013）。

### 最初の管理者を入れる

その人がまだ許可リストにいなければ、管理者の印を付けて足す。

```sh
pnpm exec wrangler d1 execute DB --remote \
  --command "INSERT INTO host_allowlist (github_user_id, note, is_admin) VALUES ('12345', 'alice', 1)"
```

### 管理者の印を付ける

すでに許可リストにいるホストを管理者にする。その人がまだ一度もログインしていなくても付けられる。

```sh
pnpm exec wrangler d1 execute DB --remote \
  --command "UPDATE host_allowlist SET is_admin = 1 WHERE github_user_id = '12345'"
```

`UPDATE` は、合う行がなくても成功する。結果の `changes` が `1` であることを確かめる。`0` なら、その人は許可リストにいないので、上の「最初の管理者を入れる」で足す。

### 管理者の印を外す

ホストのまま、管理者でなくする。管理者だけの API は、その人の同じセッションでも次の要求から 403 になる。ホストとしてのセッションは残してよいので、消さない。

```sh
pnpm exec wrangler d1 execute DB --remote \
  --command "UPDATE host_allowlist SET is_admin = 0 WHERE github_user_id = '12345'"
```

### 今の管理者を見る

```sh
pnpm exec wrangler d1 execute DB --remote --command "SELECT * FROM host_allowlist WHERE is_admin = 1"
```

### 管理者のホストを外す

管理者のホストは、画面からは外せない。先に「管理者の印を外す」を行い、そのあとで、画面から外すか、下の「コマンドで外す」の手順（許可リスト → user）を行う。印を先に外すのは、許可リストから外すまでの間も、管理者だけの API を使わせないため。外すと、その人の問題セットも消える。

## 外す（ホストの取り消し）

外すと、その人の `user` の行も消える。外部キーの cascade で、`account`・`session`・問題セット・問題も一緒に消える（[ADR 0016](../adr/0016-do-not-keep-host-personal-data.md)）。**元に戻せない。** 足し直しても問題セットは戻らない。誤って外したときに戻す方法は、D1 全体を Time Travel で外す前の時点へ戻すことしか無い（下の「誤って外したとき」）。必要なら、外す前に `pnpm exec wrangler d1 time-travel info DB` で今の位置（bookmark）を控えておく。

### 誤って外したとき

D1 全体を、控えた bookmark の時点へ戻す。控えていなければ、`--bookmark` の代わりに `--timestamp=<外す前の時刻（RFC3339）>` を渡す。

```sh
pnpm exec wrangler d1 time-travel restore DB --bookmark=<控えた bookmark>
```

戻すと、その時点より後の変更がすべて消える。ほかのホストが作った問題セットの変更も、ほかの取り消しも戻る。**とくに、その間にほかのホストを外していたら、その人の許可リストの行とセッションも戻り、Cookie が切れていなければまた使えてしまう。** 戻したら、すぐに次を行う。

1. その時点より後に外したホストを、もう一度外す。管理者の印を外していたら、それも外し直す
2. [今の管理者を見る](#今の管理者を見る)と、許可リスト全体（`SELECT * FROM host_allowlist`）を見て、いてはいけない人がいないことを確かめる

### 画面から外す（管理者）

管理者は、一覧から外す操作をするだけでよい。許可リストの行と、その人の `user` の行を、1回で一緒に消す（D1 の `batch` で、片方だけが消えることはない）。外した人は、ログインしたままの画面からでも、次の要求から 401 になり、ログインし直しても拒否される。一度もログインしていない人（`user` の行が無い）は、許可リストの行だけが消える。

管理者のホストは、画面から外せない（409）。下の「管理者のホストを外す」のとおり、先にコマンドで印を外す。

### コマンドで外す

画面が使えないときは、次を**この順で**行う。先に `user` を消すと、許可リストから外すまでの間にログインし直せ、新しい `user` の行ができてしまう。手順3で両方の結果が0行と確かめるまで、同じ人を許可リストに足し直さない。手順1と2の間に足し直してログインされると、手順2が、足し直したあとに作った問題セットまで消すため。

1. 許可リストから外す。これで次のログインから拒否され、`requireHost` も次の要求から断る

   ```sh
   pnpm exec wrangler d1 execute DB --remote \
     --command "DELETE FROM host_allowlist WHERE github_user_id = '12345'"
   ```

2. その人の `user` の行を消す。cascade で `account`・`session`・問題セット・問題も消える。`user` の ID は Better Auth のもので、GitHub の ID ではないので、`account` から引く。一度もログインしていない人は `user` の行が無いので、何も消えない

   ```sh
   pnpm exec wrangler d1 execute DB --remote \
     --command "DELETE FROM user WHERE id IN (SELECT user_id FROM account WHERE provider_id = 'github' AND account_id = '12345')"
   ```

3. 消えたことを確かめる。両方とも結果が0行になる（`account` が消えていれば、cascade で `user` も消えている）

   ```sh
   pnpm exec wrangler d1 execute DB --remote \
     --command "SELECT * FROM host_allowlist WHERE github_user_id = '12345'"
   pnpm exec wrangler d1 execute DB --remote \
     --command "SELECT user_id FROM account WHERE provider_id = 'github' AND account_id = '12345'"
   ```

### 外したあとも続くもの

- **つながったままのホスト用の WebSocket は、閉じるまで進行操作を続けられる。** 部屋の DO は、接続を開くときに1回だけホストかを確かめ、進行中は D1 に問い合わせないため（P1・ADR 0003）。その接続が閉じたあとは、つなぎ直せない
- その人が作った部屋の DO には、部屋を作ったときに写した問題セット（題名・問題文・選択肢・正解）が残る。cascade は D1 の中にしか届かないため
- 消した行は、D1 の Time Travel に7日残る。「すぐに消してほしい」と頼まれても、7日は待つことになる
- もう一度許可リストに入れると、同じ GitHub のアカウントでログインできる。ただし新しい `user` になり、問題セットは空から始まる

### すぐに止めたいとき

開いている部屋の進行も今すぐ止めたいときは、次のどちらかにする。

- その部屋を終えてもらう。進行画面から部屋を終えると、その部屋のすべての接続が閉じる
- Worker を消す。すべての部屋が止まる（[stop-and-usage.md](stop-and-usage.md#止める)）
