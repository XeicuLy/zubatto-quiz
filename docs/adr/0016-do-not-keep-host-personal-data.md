# ホストの個人情報は D1 に持たず、ホストを外したら user の行ごと消す

## Status

accepted

## Context

[ADR 0003](0003-host-identification-and-host-connection.md) で、ホストは GitHub ログインと許可リストで見分けると決めた。ログインは Better Auth の既定のまま動いており、アプリが使わない値まで D1 に残っている（#341 の所見 A1・A7）。

| 表        | 列                         | 中身                                                                       | アプリが使うか                  |
| --------- | -------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| `user`    | `id`                       | Better Auth が作る ID                                                      | 使う（問題セットの `owner_id`） |
| `user`    | `name`                     | GitHub の表示名（`profile.name \|\| profile.login`）。本名のことがある     | 使う（画面のログインの表示）    |
| `user`    | `email`                    | GitHub の主な email（`user:email` の scope で `/user/emails` から読む）    | 使わない                        |
| `user`    | `image`                    | アバターの URL                                                             | 使わない                        |
| `account` | `account_id`               | GitHub の数値の ID                                                         | 使う（許可リストと照らす）      |
| `account` | `access_token`・`scope`    | GitHub のトークン（`encryptOAuthTokens` で暗号化済み）と、許可された scope | 使わない                        |
| `session` | `token`                    | セッションの Cookie の値                                                   | 使う                            |
| `session` | `ip_address`・`user_agent` | ログインしたときの IP と User-Agent                                        | 使わない                        |

また、ホストを外しても、消えるのは許可リストの行とセッションだけで、`user`・`account`・問題セットは残り続ける（所見 A2、[ADR 0013](0013-host-admin-role.md)）。要件の S5 は回答者しか扱っておらず、ホストのデータを決めた文書が無い。

#342 で、次のことを better-auth 1.7.20 のテスト用の auth で動かして確かめた（2026-11-20、結果は #341 のコメント）。

- `databaseHooks.account.create.before` が返す値で、`accessToken`・`refreshToken`・`idToken`・`scope` を空にできる。2回目のログインで呼ばれる `account.update.before` でも同じにできる。`update.before` には `scope` が渡らないので、create で空にした値がそのまま残る
- github の `mapProfileToUser` で合成の email（`<GitHub の ID>@users.zubakui.invalid`）を入れても、2回目のログインが通る。GitHub 側の email を変えても同じ user のまま。別の GitHub ユーザーが同じ実の email を持っていても、別の user になる。`image: null`、`name: profile.login` も入る

さらに、次のことを better-auth 1.7.20 のソースで確かめた（2026-11-21）。

- github の provider の scope は、既定で `read:user` と `user:email`。`disableDefaultScope: true` にすると空になる
- provider は `mapProfileToUser` があっても `/user/emails` を呼ぶ。ただし、その応答のエラーは読まずに捨てる（`const { data: emails }`）。scope が空で `/user/emails` が失敗しても、ログインは止まらないはず（動かしては確かめていない）
- 2回目のログインで `user` の行を書き換えるのは、provider の `overrideUserInfoOnSignIn` が true のときだけ（既定は false）。そのため、ログインの設定を変えても、既にある行の email はそのまま残る
- `advanced.ipAddress.disableIpTracking: true` にすると、Better Auth が要求から IP を読まなくなる（Better Auth の rate limiter も IP を鍵にできなくなる）

GitHub の文書で、次のことを確かめた（context7、2026-11-21）。

- 認可の URL に `scope` が無いと、その OAuth App を前に許可したことのある人は、許可の画面を出さずに、前に許可した scope の付いたトークンを受け取る。1.7.20 の `createAuthorizationURL` は、scope の配列が空だと `scope` を付けない（`if (scopes?.length)`）。そのため scope を求めない設定でも、前に `user:email` を許可した人には、`user:email` の付いたトークンが返る
- scope が無くても、`/user` は公開プロフィールの `email` を返す。email を公開している人なら、新しく許可する人でも、Better Auth はその email を受け取る
- トークンに付いた scope は、トークン交換の応答の `scope` と、API の応答の `X-OAuth-Scopes` ヘッダーで分かる
- ユーザーが GitHub の設定（Settings → Applications → Authorized OAuth Apps）で許可を取り消すと、その OAuth App のトークンも全部使えなくなる。OAuth App の設定の「Revoke all user tokens」が、トークンだけでなく許可まで消すかは、文書には書かれていない

どの場合も、受け取った email は `mapProfileToUser` が保存の前に合成の値で上書きするので、D1 には入らない。

D1 の Time Travel は、Workers Free では7日前までのどの時点にも戻せる。部屋の DO の SQLite は、PITR で30日前までのどの時点にも戻せる（どちらも Cloudflare の文書を context7 で、2026-11-21）。行を書き換えても消しても、古い値はその日数のあいだ戻せる形で残る。

部屋を作るとき、問題セットは部屋の DO に写す（[ADR 0002](0002-question-set-storage-and-room-handoff.md)）。写すのは、`room` の題名と `owner_id`（Better Auth の `user.id`）、`questions` の問題文・選択肢・正解。D1 には部屋の表が無いので、ホストの ID からそのホストの部屋を探す手立ては無い。部屋の DO には、データを消す処理がまだ無い（部屋の寿命は #360 で決める）。

Better Auth の版を上げて、hook の返す値が効かなくなった場合の扱いも決めておく。

- #345 のテスト（実際にログインして、保存された行を確かめる）は CI で動く。`main` のルールセットは CI が落ちた PR をマージさせないので、hook が効かない版は Dependabot の PR の時点で止まり、本番には入らない。ふだんはその版を見送り、hook の書き方を直してから上げる
- それでも上げなければならないとき（Better Auth の脆弱性の修正など）だけ、hook を直すまでの間、次のどちらかを使う。どちらでも、トークンを保存するのは hook ではなく Better Auth の既定の動きで、`encryptOAuthTokens` で暗号化した値を INSERT する（1.7.20 の `setTokenUtil`）
  1. `account.create.after`・`update.after` の hook で、同じ規則の UPDATE を流す。D1 の行からはすぐ消えるが、INSERT した値は Time Travel に7日残る
  2. 1 も効かなければ、ログインがあったあとに #347 の書き換えのコマンドを流す。流すまでは D1 に残る
- どちらの案も、暗号化したトークンが D1 か Time Travel に残るので、DD1（トークンを D1 と Time Travel から読めない）を満たさない。そのため、この間は S5 の例外として扱う。暗号化されたトークンが、hook を直して #347 のコマンドを流すまで D1 に、そのあと7日は Time Travel に残る。例外にした日と戻した日を、この ADR に追記する。暗号化の鍵（`BETTER_AUTH_SECRET`）が漏れた疑いがあるときは、OAuth App の設定の「Revoke all user tokens」で、全員のトークンを使えなくする

## Decision Drivers

- DD1 セキュリティ（S5 をホストへ広げる）: D1 か Time Travel の中身が漏れても、ホストの email・アバター・GitHub のトークン・IP・User-Agent・本名が読めない。外したホストのデータは、D1 には Time Travel の7日を除いて残らない
- DD2 ロックイン耐性（ADR 0008）: Go 版でも、同じ列に同じ値を入れる規則で作れる。Better Auth の暗号化の形などに頼らない
- DD3 機能を落とさない: 許可リストの3か所の確認（`validateUserInfo`・`session.create.before`・`requireHost`）と、ログインの使い勝手を変えない。email の `NOT NULL UNIQUE` を満たす（Better Auth は email が空だと `EMAIL_NOT_FOUND` でログインを止める）

## Considered Options

- 軸H: ホストの個人情報をどう扱うか
  - H1. 持たない。email は合成の値、`image`・トークン・`scope`・IP・User-Agent は空、`name` は login
  - H2. 暗号化して持つ。トークンと同じく、email・IP・User-Agent も `BETTER_AUTH_SECRET` から作った鍵で暗号化する
  - H3. 今のまま持ち、持っているものと理由を文書に書く
- 軸E: 合成の email の形（H1 のとき）
  - E1. `<GitHub の ID>@users.zubakui.invalid`
  - E2. GitHub の noreply の形（`<ID>+<login>@users.noreply.github.com`）
  - E3. ランダムな値（`<uuid>@users.zubakui.invalid`）
- 軸U: GitHub に求める scope
  - U1. 求めない（`disableDefaultScope: true`）
  - U2. `read:user` だけ
  - U3. 今の既定のまま（`read:user`・`user:email`）
- 軸W: 既にある行
  - W1. コマンドで1回書き換え、新しい行と同じ形にそろえる
  - W2. 書き換えず、次のログインを待つ
  - W3. ホストの行を全部消し、ログインし直してもらう
- 軸R: ホストを外したとき
  - R1. `user` の行ごと消す（cascade で `account`・`session`・問題セットも消える）
  - R2. 今のまま、許可リストの行とセッションだけを消す

## Decision Outcome

採用する選択肢: 「H1・E1・U1・W1・R1」。ホストの個人情報は D1 に持たず、email は GitHub の ID から作る届かない値にし、GitHub には scope を求めない。既にある行は1回書き換えてそろえ、ホストを外したら `user` の行ごと消す。

軸ごとの比べ合いは次のとおり。

軸H

|     | H1 持たない                                                                                                                                | H2 暗号化して持つ                                                                                                                                                   | H3 今のまま                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| DD1 | 持っていない値は漏れない。ログインの記録から分かるのは GitHub の ID と login だけ。書き換えた古い値は Time Travel に7日だけ残る            | 鍵（`BETTER_AUTH_SECRET`）が同じ Worker の secret にあるので、効くのは D1 の中身だけが漏れた場合だけ。Worker を書き換えられる人には読まれる。外したホストの値も残る | ✗ 漏れれば email・IP・UA が読める |
| DD2 | 「この列は空、この列は合成の値」という規則なので、Go 版でも同じに作れる                                                                    | Better Auth の暗号化の形（アルゴリズムと鍵の作り方）に、Go 版も合わせることになる                                                                                   | 変わらない                        |
| DD3 | アプリが読むのは `user.id`・`user.name`・`account.account_id` だけなので、許可リストの確認も画面も変わらない。`name` は login の表示になる | Better Auth が暗号化するのはトークンだけで、email・IP・UA は自分で書く。email は `UNIQUE` で引くのにも使う列なので、決定的な暗号化にする必要がある                  | 変わらない                        |

軸E・U・W・R

| 軸  | 採用 | 採らなかった案と理由                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E   | E1   | E1 の中身は `account_id` に既にある GitHub の ID だけで、新しく分かることは無い。`.invalid` は届かないことが決まっているトップレベルドメイン（RFC 6761）。`account_id` から作り直せるので、#347 の書き換えも Go 版も同じ値を出せる。E2 は GitHub に実在する宛先で、メールを送る機能を将来足すと本人に届く。login も2か所に持つことになる。E3 は ID から作り直せず、書き換えを2回流すと結果が変わる                                                                                                                                                                                                                                           |
| U   | U1   | U1 なら、新しく許可する人の分は、トークンで読めるのが公開の情報だけになり、Better Auth が受け取る email も、公開している人の公開の email だけになる。GitHub の同意の画面にも、求める権限が出ない。ただし、前に `user:email` を許可した人には、前の許可の付いたトークンが返り、非公開の email も届く（Context）。そこで、全員の前の許可を一度取り消してそろえる。どの場合も、email とトークンは保存しない。U2 は、プロフィールの非公開の部分まで読めるトークンになるが、使い道が無い。U3 は非公開の email まで読め、Better Auth が本物の email を一度受け取る。U1 で `/user/emails` が失敗してもログインが通ることは、#345 のテストで確かめる |
| W   | W1   | W2 では、`overrideUserInfoOnSignIn` が false なので email はずっと残り、DD1 を満たさない。W3 は問題セットまで消え、DD3 を満たさない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| R   | R1   | R2 では、外したホストの login・GitHub の ID・ホストが書いた問題文が残り続ける（DD1）。R1 の外部キーの cascade は普通の SQL なので、Go 版でもそのまま使える（DD2）。R1 は元に戻せない。足し直しても問題セットは空で、誤って外したときに戻す方法は、DB 全体を Time Travel で戻すことしか無い。確認の文言と手順書でこれを伝える                                                                                                                                                                                                                                                                                                                 |

決めた形は次のとおり。

- 保存する値（H1・E1）
  - `user.email`: `<GitHub の ID>@users.zubakui.invalid`。`emailVerified` は false（email の一致による、別のアカウントとの暗黙の連携も止まる）
  - `user.name`: GitHub の login。`user.image`: null
  - `account` の `accessToken`・`refreshToken`・`idToken`・`scope`: null。`encryptOAuthTokens` は、空にできなかったときの二重の守りとして残す
  - `session` の `ipAddress`・`userAgent`: 持たない（`disableIpTracking` と、`session.create.before` で `userAgent` を空にする）
  - 何をどう保存するかは、`apps/api/src/auth/host-data-policy.ts` の1か所に置き、ログインの hook と既にある行の書き換えの両方がそこから引く
- scope（U1）: github の provider に `disableDefaultScope: true` を付け、scope を足さない。#345 を本番に出したあと、本番とローカルの OAuth App の設定で「Revoke all user tokens」を押し、全員の前の許可を取り消す。全員が次のログインで、scope の無い許可をし直す。「Revoke all user tokens」で許可まで消えるかは #345 で確かめ、許可が残るなら、ホストそれぞれに GitHub の設定（Settings → Applications → Authorized OAuth Apps）で許可を取り消してもらう
  - 確かめた結果（#345、2026-11-26）: ローカルの OAuth App で、前に許可した状態から「Revoke all user tokens」を押してログインし直すと、同意の画面が出た。トークンだけでなく許可も消えるので、ホストそれぞれに取り消してもらう手順は要らない
- 既にある行（W1）: `host-data-policy.ts` の規則から作った SQL を、`wrangler d1 execute` で1回流す。変える行の数を先に見る SELECT と、書き換えの UPDATE を分け、何度流しても同じ結果になる形にする。本番で流すのは、手順書に沿って人が行う
- 外すとき（R1）: ADR 0013 の「許可リストの行とその人のセッションを、1つの `db.batch` で消す」を、次のように広げる
  - 同じ1つの `db.batch` で、その人の `user` の行も消す。cascade で `account`・`session`・`question_sets`・`questions` も消える
  - `user` を消す文は、許可リストの行を副問い合わせで引くので、許可リストの行を消す文より前に置く
  - どの文にも `is_admin = false` の条件を付け、先に確かめずに消してから、消えなかったときだけ理由を読む（ADR 0013 のまま）。管理者の行は、どの文でも消えない
  - 一度もログインしていないホスト（`user` の行が無い）も、今と同じく外せる
  - 今のセッションを消す文は、cascade と重なる。残すかどうかは #346 で決め、理由をコメントに書く
  - 部屋の DO に写した問題セットには、cascade が届かない。外すときにそのホストの部屋を探せないので、外す処理では消さず、部屋の寿命（#360）で片づくまで残す。#337 で D1 に部屋の表を持つことになったら、外すときに部屋も片づけるかを、そこで決め直す
- 要件: S5 を、回答者とホストの両方を扱う決まりに書き直す

## Consequences

- 良い影響: D1 か Time Travel の中身が漏れても、ホストについて分かるのは GitHub の ID と login、問題セットだけになる。トークンも持たないので、暗号が解かれても GitHub に対して使えるものが無い。ただし、書き換えたり消したりしてから7日は、古い値（email・IP・暗号化されたトークンなど）が Time Travel に残る（悪い影響を参照）
- 良い影響: 外したホストの D1 のデータは、Time Travel の7日を過ぎると残らない（部屋の DO の写しは悪い影響を参照）
- 良い影響: GitHub の同意の画面に、email を読む権限が出なくなる
- 悪い影響: ホストを外すと、その人の問題セットも消え、元に戻せない。誤って外したときに Time Travel で戻すと、ほかのホストの変更も同じ時点まで戻る
- 悪い影響: 画面のログインの表示が、GitHub の表示名から login に変わる。GitHub で login を変えても、表示は最初のログインのときのまま（`overrideUserInfoOnSignIn` が false のため。今の表示名も同じ）
- 悪い影響: 書き換えても消しても、古い値は Time Travel に7日残る。「すぐに消してほしい」と頼まれても、7日は待つことになる（手順書に書く）
- 悪い影響: 外したホストの問題セットの写し（題名・問題文・選択肢・正解）は、その人が開いた部屋の DO に、部屋の寿命（#360）まで残る。片づけたあとも、DO の PITR で30日は戻せる形で残る
- 悪い影響: Better Auth の既定の動きを、hook と設定で上書きしている。版を上げて hook の返す値が効かなくなっても、型やビルドでは気付けない。#345 のテスト（実際にログインして、保存された行を確かめる）が CI で止める。脆弱性の修正などで上げなければならないときは、Context の代わりの案を使い、その間は S5 の例外になる
- 悪い影響: `disableIpTracking` を入れると、Better Auth の rate limiter は IP を鍵にできない。ログインの絞り込みは、API の Worker の Rate Limiting binding で行う（#348・#350）
- 悪い影響: Cloudflare の基盤が残すログ（Workers Logs と `wrangler tail`）には、ホストの IP も残る。回答者と同じく受け入れる（S5、ADR 0005）
- 対応事項（#345）: `host-data-policy.ts` を作り、`createAuthOptions` に `mapProfileToUser`・`disableDefaultScope: true`・`disableIpTracking: true`・account の hook（トークンと scope を空にする）・`session.create.before` での `userAgent` を空にする処理を入れる。テスト用の auth で実際にログインし、1回目と2回目のどちらでも、user・account・session の行に本物の email・image・トークン・IP・User-Agent が無いことを確かめる。scope が空でもログインが通ることも確かめる。ローカルの OAuth App で、前に `user:email` を許可した状態から「Revoke all user tokens」を押してログインし直し、トークン交換の応答の `scope` が空になるか（許可まで消えるか）を確かめて、結果をこの ADR に追記する。`backend.md` の「ホストの認証」に、保存するものとしないものを書く
- 対応事項（#346）: `removeHost` の `db.batch` で `user` の行も消す。外すと user・account・session・question_sets・questions が消えること、管理者の行はどの文でも消えないこと、一度もログインしていないホストも外せること、ほかのホストの行は残ることを、テストで確かめる。確認の文言を「問題セットも消え、元に戻せない」に直し、`host-allowlist.md` の「外す」の手順とコマンドの SQL を合わせる
- 対応事項（#347）: 既にある行を、`host-data-policy.ts` の規則で1回書き換えるコマンドと、手順書（流す前に Time Travel の位置を控える、確かめの SELECT、書き換え、結果の確かめ、ホストから消してほしいと頼まれたとき）を作る。書き換えたあとも、同じ人が同じ user でログインできることを確かめる。手順書には、OAuth App の「Revoke all user tokens」で全員の前の許可を取り消す手順も書く（許可まで消えることは #345 で確かめた）
- 対応事項（#360）: 部屋の寿命を決めるとき、外したホストの問題セットの写しが寿命まで残ることを含めて、要件 S5 に保存の期間を書く
- 対応事項: 要件定義書の S5 を、ホストも扱う形に直す。docs/README.md の ADR の一覧に1行足し、ADR 0013 の外すときの決まりに、この ADR を指す一言を足す
