# ホストのデータ

D1 に持つホストのデータは、GitHub の ID と login と、ホストが作った問題セットだけにする（S5・[ADR 0016](../adr/0016-do-not-keep-host-personal-data.md)）。ログインのたびに守る規則は `apps/api/src/auth/host-data-policy.ts` にある。この手順書は、その規則が入る前に保存された行をそろえるときと、ホストから「データを消してほしい」と頼まれたときに使う。

| 表        | 規則どおりの値                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `user`    | `name` は GitHub の login、`email` は `<GitHub の ID>@users.zubakui.invalid`、`email_verified` は `0`、`image` は空 |
| `account` | `access_token`・`refresh_token`・`id_token`・`scope` は空                                                           |
| `session` | `ip_address`・`user_agent` は空                                                                                     |

## いつ使うか

- 規則が入る前（#345 より前）にログインしたホストの行を、1回そろえる。ログインの設定を変えても、既にある行は書き換わらない（2回目のログインで `user` を書き換えない設定のため）。本番では、#345 が入った版をデプロイしたあとに1回流す
- Better Auth の版を上げて、ログインの hook が効かなくなっていた間にログインがあったとき（ADR 0016 の Context の、代わりの案の2）。hook を直したあとで、もう一度流す
- ホストから「データを消してほしい」と頼まれたとき（下の「消してほしいと頼まれたとき」）

## コマンドの場所

`pnpm --filter` のコマンドはリポジトリの root で、`pnpm exec wrangler` のコマンドは `apps/api` で実行する。`DB` は `wrangler.jsonc` の D1 の binding の名前。

- 本番: `--remote` を付ける。先に `apps/api` で `pnpm exec wrangler login` でログインしておく
- ローカル（`vite dev`）: `--remote` の代わりに `--local --persist-to ../web/.wrangler/state` を付ける。ローカルの D1 には Time Travel が無いので、下の手順1は飛ばす

`host-data:check` と `host-data:scrub` は、`apps/api/scripts/scrub-host-data.ts` が規則から作った SQL を、`wrangler d1 execute` に渡す。デプロイしたルートからは流せない。流す SQL を見るときは、`apps/api` で `node scripts/scrub-host-data-cli.ts check`（または `scrub`）を実行する。

## 前からある行をそろえる

前もって、#345 の入った版が本番で動いていることを確かめる（[deploy.md](deploy.md#デプロイのあとに確かめる)の手順0）。入っていないと、そろえたあとのログインで、また古い形の行ができる。

1. 今の Time Travel の位置（bookmark）を控える。書き換えを誤ったときに戻すためのもの。戻すと D1 全体がその時点に戻り、その後のほかのホストの変更も消えるので、戻す前に [host-allowlist.md の「誤って外したとき」](host-allowlist.md#誤って外したとき)の注意を読む

   ```sh
   cd apps/api
   pnpm exec wrangler d1 time-travel info DB
   ```

2. 書き換える行の数を見る。`user_rows`・`account_rows`・`session_rows` が、それぞれの表で規則と違う行の数。全部 `0` なら、手順3と4は要らない

   ```sh
   pnpm --filter @zubatto-quiz/api run host-data:check --remote
   ```

3. 書き換える。3つの UPDATE は、どれも規則と違う行だけを書き換えるので、途中で失敗しても、もう一度流せば同じ結果になる

   ```sh
   pnpm --filter @zubatto-quiz/api run host-data:scrub --remote
   ```

4. 手順2と同じコマンドをもう一度流し、3つとも `0` になったことを確かめる。中身も見るときは、[github-oauth-apps.md の「確かめる」](github-oauth-apps.md#確かめる)の SELECT を流す
5. `name` を直す。`name` は規則では GitHub の login だが、前の行には GitHub の表示名（本名のことがある）が入っている。D1 には login が無く、SQL では作り直せないので、1人ずつ直す。出力には本名が入ることがあるので、手元に残さず、どこにも貼らない
   1. ホストの GitHub の ID と、今の `name` を見る（手順1と同じく `apps/api` で実行する）

      ```sh
      pnpm exec wrangler d1 execute DB --remote \
        --command "SELECT account.account_id, user.name FROM user JOIN account ON account.user_id = user.id WHERE account.provider_id = 'github'"
      ```

   2. 行ごとに、GitHub の ID から今の login を引く

      ```sh
      gh api user/<GitHub の ID> --jq .login
      ```

   3. `name` が login と違う行だけ、login に書き換える。login は英数字とハイフンだけなので、そのまま `'` で囲んでよい。結果の `changes` が `1` であることを確かめる

      ```sh
      pnpm exec wrangler d1 execute DB --remote \
        --command "UPDATE user SET name = '<login>' WHERE id IN (SELECT user_id FROM account WHERE provider_id = 'github' AND account_id = '<GitHub の ID>')"
      ```

   4. 手順5の1をもう一度流し、どの行の `name` も login になったことを確かめる

6. 前の許可を取り消す。前に `user:email` を許可した人は、scope を求めないログインでも、前の許可の付いたトークンを受け取る（[github-oauth-apps.md の「求める権限」](github-oauth-apps.md#求める権限scope)）。本番とローカルの OAuth App の設定（GitHub の Settings → Developer settings → OAuth Apps）で、それぞれ Revoke all user tokens を押す
   - トークンだけでなく、許可も消える（#345 で確かめた、2026-11-26）。全員が次のログインで、scope の無い許可をし直す
   - ズバクイのセッションは D1 にあるので、押しても切れない。ログインしたままのホストは、そのまま使える
   - 1回押せば足りる。規則が入ってから許可した人の許可には、もともと scope が無い
7. 書き換えた日を控える。古い値（email・アバター・暗号化されたトークン・IP・User-Agent・本名）は、D1 の Time Travel に7日残る（Workers Free、Cloudflare の文書で 2026-11-28 に確かめた）。7日を過ぎれば、D1 のどこからも読めない

## 消してほしいと頼まれたとき

ホストから、自分のデータを消してほしいと頼まれたら、次のようにする。

1. その人の GitHub の ID を確かめる（`gh api users/<GitHub のログイン名> --jq .id`）
2. 何が消えるかを伝える。D1 に持っているのは、GitHub の ID・login・その人が作った問題セットだけ。消すにはホストから外すことになり、**問題セットも消え、元に戻せない**。ホストを続けたまま消せるものは無い
3. 了承をもらったら、ホストから外す（[host-allowlist.md の「外す」](host-allowlist.md#外すホストの取り消し)）。`user`・`account`・セッション・問題セット・問題が一緒に消える
4. 外したあとも残るものを伝える。どれも、こちらから選んで早く消すことはできない
   - D1 の Time Travel に、消した行が7日残る。Time Travel は D1 全体を戻すためのもので、行を選んで消せない。その人が規則の入る前にログインしていて、上の「そろえる」より後に外したなら、書き換える前の古い値も、書き換えた日から7日は残る
   - その人が開いた部屋の Durable Object に、部屋を作ったときに写した問題セットが残る。部屋の寿命（#360）まで残り、片づけたあとも、Durable Object の PITR で30日は戻せる形で残る
   - Cloudflare のログ（Workers Logs と `wrangler tail`）に、要求の IP が残る（[logs.md](logs.md#ログに残るもの残らないもの)）
5. GitHub の側の許可は、本人が GitHub の Settings → Applications → Authorized OAuth Apps で取り消せることを伝える

## 規則を変えたとき

保存する値を変えるときは、`host-data-policy.ts` を直す。ログインの hook と `host-data:check`・`host-data:scrub` の SQL は、どちらもそこから値を引くので、別々に直すことはない。直したら、この手順書の表を合わせ、上の「そろえる」を流して、前からある行も新しい規則にそろえる。
