# UI 部品は shadcn/ui の Base UI 版で作り、役割トークンは shadcn の名前にそろえる

## Status

accepted

## Context

ボタン・入力欄・カード・確認の class が画面ごとに書き写され、フォーカスの見せ方や角の丸みが少しずつ違う（#122）。Button / Field / Card / ConfirmDialog を `components/ui` にまとめるにあたり、部品を自分で書くか、shadcn/ui を入れるかを決める。役割で名前を付けた色トークン（#124）と、文字・余白・フォーカスのトークン（#125）の名前も、部品の作り方に合わせてここで決める。

心配だったのは CSP である。`apps/web/public/_headers` の CSP には `style-src` がなく、`default-src 'self'` が使われるので、インラインの `<style>` 要素は止まる（ADR 0004・0006）。shadcn/ui の Radix 版の Dialog は、react-remove-scroll を通して `<style>` を差し込むと言われていた。推測で決めず、本番と同じ CSP の上で動かして確かめた。

shadcn/ui は部品のソースを手元にコピーする仕組みで、2026年7月から、新しく作るプロジェクトの既定の土台（プリミティブ）を Radix から Base UI に替えた（Radix も引き続き使える）。仕様は 2026-10-29 に公式ドキュメント（context7 が月の上限に達していたので、ui.shadcn.com と base-ui.com を直接）で確かめた。

### 本番と同じ CSP の上で確かめたこと

2026-10-29 に、捨てるブランチで `pnpm --filter @zubatto-quiz/web run e2e:serve`（`vite build` + `vite preview`、`_headers` の CSP が付く）を動かし、ライブラリごとに分けた画面を Playwright の Chromium（390×844）で開いた。違反は `e2e/helpers/csp.ts` の `collectCspViolations` で集めた。スパイクのコードは捨て、この ADR だけを残す。

開く前の予想は「Radix は違反が出る（A）、Base UI は出ない（B）」だった。Dialog については当たった。

| 部品（版）                                                                | CSP の違反                                                                                                  | ほかに確かめたこと                                                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Radix の Dialog（`radix-ui` 1.8.1）                                       | 開くたびに1件。react-remove-scroll-bar が差し込む `<style>`                                                 | 止まった `<style>` は `body` の `overflow: hidden` だが、ホイールは JS で止めるので、ページは動かなかった               |
| Base UI の Dialog（`@base-ui/react` 1.9.0）                               | 0件                                                                                                         | スクロールは `body.style.overflow` を JS（CSSOM）で書き換えて止める。CSP は JS からの `style` の書き換えを止めない      |
| Base UI の ScrollArea                                                     | 1件（ネイティブのスクロールバーを隠す `<style>`）。`<CSPProvider disableStyleElements>` で囲むと0件になった | 公式ドキュメントでは、`alignItemWithTrigger` を付けた Select も同じ `<style>` を出す                                    |
| shadcn/ui の AlertDialog・Button・Field・Input（CLI 4.22.1、`base-nova`） | 0件                                                                                                         | 開くと「やめる」にフォーカスが当たり、Esc で閉じると開いたボタンへ戻る（#111 で決めた確認の動きと同じ）。`tsc` も通った |

どの Dialog も、フォーカスはダイアログの中に閉じ込められた。Radix の違反は、ハッシュで許すこともできない。差し込む `<style>` には実行時に測るスクロールバーの幅（`padding-right: 0px` など）が入るので、端末ごとに中身とハッシュが変わる。nonce は要求ごとに変える値なので、静的なファイルとして配る SPA では使えない。

増える量も測った（`vite build` の gzip 後。今の回答者が最初に読む JS は 78.4 KB）。

| 部品                                                | 増える JS                                           | 増える依存（本体と、推移的なものを含むその依存）                                                                                           |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Radix の Dialog                                     | 13.3 KB                                             | `radix-ui` と、その依存 73（`radix-ui` はすべての部品を1つにまとめたもの）                                                                 |
| Base UI の Button・Field・Input（参加フォームの形） | 約 10.5 KB（部品 5.3 KB と、共通のチャンク 5.1 KB） | `@base-ui/react` と、その依存 8                                                                                                            |
| Base UI の Dialog                                   | 約 21 KB（共通のチャンクを含む）                    | 同上                                                                                                                                       |
| shadcn/ui の部品が読み込むもの                      | —                                                   | 上に加えて3つ。`class-variance-authority` 0.7.1 と、その依存の `clsx`、`cn` 0.5.0（shadcn の class 結合。依存なし）。CLI 4.22.1 で確かめた |

### デジタル庁デザインシステムの値

トークンの値は、デジタル庁デザインシステム（β版）を手本にする。2026-10-29 に確かめた。

- 文字（「タイポグラフィ」、2026-08-05 更新）: トークン名は `Std-17N-170` のように、種類・px・太さ（N=400、B=700）・行間(%) をつなげたもの。本文は 16〜17 px・行間 170%、見出しは 20〜32 px・行間 150%、大見出しは 36〜45 px・行間 140%、ボタンなどの1行のもの（Oneline）は 14〜17 px・行間 100%・字間 0.02em。字間は 26 px 以下で 2%
- 色とコントラスト（「カラー」、2026-08-05 更新）: 文字は背景に対して 4.5:1 以上、アイコンや枠などの文字でないものは隣の色に対して 3:1 以上。フォーカスの色は Yellow-300 と黒の二重
- フォーカスリング（React 版サンプル v2.7.0 の Button）: `outline` 黒 4 px、`outline-offset` 2 px、その内側に `ring` の Yellow-300 を 2 px（`focus-visible:outline-4 focus-visible:outline-black focus-visible:outline-offset-[calc(2/16*1rem)] focus-visible:ring-[calc(2/16*1rem)] focus-visible:ring-yellow-300`）

## Decision Drivers

- DD1 セキュリティ（ADR 0004・0006）: `_headers` の CSP を変えずに動く。`style-src` も、`'unsafe-inline'` も、ハッシュも足さない。E2E の `collectCspViolations` が空のままになる
- DD2 変更容易性: 4つの部品を、暗い面（stage）と明るい面（backstage）の両方で使える。あとで部品（Select・Toast など）を足すときも、作り方を変えずに済む
- DD3 学習コスト: 部品の ARIA とフォーカスの動き（#111）を、自分のことばで説明できる。ライブラリに合わせて覚えることが少ない、またはその学びに値打ちがある
- DD4 ロックイン耐性: 画面のコードが、土台のライブラリの API に直接つながらない。差し替えるときは `components/ui` の中だけを直せばよい
- DD5 パフォーマンス: 回答者が最初に読む JS（gzip 後 78.4 KB）を大きく増やさない。部品のために増える量を gzip 後の KB で比べる
- DD6 運用コスト: 増える依存の数。更新、脆弱性への対応、pnpm の `minimumReleaseAge` の手間がそれに比例する

## Considered Options

部品の作り方:

- U1. shadcn/ui（Radix 版）: `shadcn init -b radix`。`radix-ui` と、cva などの道具を入れ、部品のソースを `components/ui` にコピーする
- U2. shadcn/ui（Base UI 版）: shadcn の今の既定。`@base-ui/react` と、cva などの道具を入れ、部品のソースを `components/ui` にコピーする
- U3. 自作（依存なし）: `components/ui` に、書き下した class の対応表で作る（`features/results/` の variant と同じやり方）
- U4. 自作に、要るときだけ Base UI: U3 を基本にし、Select のように自分で作ると ARIA が重い部品が要ったときだけ、その部品に限って `@base-ui/react` を入れる

役割トークンの名前:

- N1. shadcn 式: `background`/`foreground`、`primary`/`primary-foreground`、`muted`、`destructive`、`border`、`ring`
- N2. 今の `on-*` 式を広げる: `surface`/`on-surface`、`primary`/`on-primary`、`danger`/`on-danger`、`focus`
- N3. デジタル庁式: 色は Primary/Secondary/Tertiary とグレーの段、文字は `Std-17N-170` のような値の名前

## Decision Outcome

採用する選択肢: 部品は「U2（shadcn/ui の Base UI 版）」、名前は「N1（shadcn 式）」。

理由:

- U2 は DD1 を満たす。Dialog・AlertDialog・Button・Field・Input は、何もしなくても違反が0件だった。`<style>` を出す ScrollArea と Select も、`CSPProvider disableStyleElements` で止められる（DD1）
- 部品の数が一番多く、あとで Select・Toast・Combobox が要っても、`shadcn add` で同じ作り方のまま足せる（DD2）
- shadcn の使い方を学ぶ値打ちがある。開発者は shadcn/ui に PR を出したことがあり、コピーした部品は手元のソースなので、ARIA とフォーカスの動きも読んで確かめられる（DD3）
- 画面は `components/ui` の部品だけを使い、Base UI を直接 import しない。土台を替えるときは `components/ui` の中で済む（DD4）
- 増える JS は、参加フォームで gzip 後に約 10.5 KB（今の最初の JS の約13%）。4G のスマホで数十 ms ほどなので、許せる量と判断した。確認のダイアログ（約 21 KB）は、ホストと管理の画面だけが読み、回答者は読まない（DD5）
- 名前は、コピーした部品が使う名前（`bg-primary text-primary-foreground`、`ring-ring` など）にそろえる。そうすれば、部品を書き換えずに使え、あとで `shadcn add` で取り込み直すのも楽になる（DD2）
- U1 は DD1 を満たせないので外した。Dialog を開くたびに違反が出て、ハッシュでも nonce でも許せない。E2E の CSP の確認も毎回落ちる
- U3 と U4 は、DD1・DD5・DD6 では U2 より良い（増える JS と依存がふだんは0）。それでも、学びの値打ち（DD3）と、部品を足すときの作り方がそろうこと（DD2）を重く見て、U2 にした
- N2 は今の `on-stage`・`on-choice` と形がそろうが、コピーした部品の class を毎回書き換えることになるので外した
- N3 の `Std-17N-170` は値の名前で、役割の名前ではない（#122 のゴールに合わない）ので外した。デジタル庁デザインシステムは、名前ではなく値の手本として使う

## Consequences

- 良い影響: 部品の作りが shadcn/ui にそろい、あとで部品を足すときも `shadcn add` で同じ形のまま足せる
- 良い影響: 部品のソースは手元にあるので、フォーカスリングや variant を、このアプリの決まりに合わせて書き換えられる
- 良い影響: CSP は今のまま（`style-src` を足さない）で動く
- 悪い影響: 依存が増える（`@base-ui/react` とその依存 8、`class-variance-authority` とその依存の `clsx`、`cn`）。更新と脆弱性への対応が、その分増える
- 悪い影響: 参加フォームの JS が gzip 後に約 10.5 KB 増える
- 悪い影響: 部品の variant は、書き下した class の対応表ではなく cva で持つ。`features/results/` の対応表と、書き方が2通りになる。cva も class を文字列のまま書くので、Tailwind が class を見つけられないことはない
- 対応事項: ルート（`__root`）を `<CSPProvider disableStyleElements>` で囲む。ScrollArea や Select を足したときに、`<style>` が出ないようにするため。部品を足す PR では、その部品を開く E2E が `collectCspViolations` で空になることを確かめる
- 対応事項: 画面は `components/ui` の部品だけを使い、`@base-ui/react` を直接 import しない。oxlint の `no-restricted-imports` で、`components/ui` の外からの import を止める
- 対応事項: import の別名は `@/*` にそろえる。アプリ（`apps/web`・`apps/api`）では、`@/*` をそのアプリの `src/*` に向ける（tsconfig の `paths` と、Vite・vitest の alias。web の `vitest.config.ts` は `vite.config.ts` を読まないので、両方に書く）。`packages/*` と `tools/*` では使わず、相対パスのままにする。`protocol` と `scoring` は `exports` でソース（`./src/index.ts`）のまま読み込まれるので、中で `@/` を使うと、読み込む側のアプリの別名で解決されてしまう。`tools/loadtest` は Node の type stripping で動き、tsconfig の `paths` を読まない。今ある相対パスの import の書き換えは、別の Issue で行う
- 対応事項: `shadcn init` は #124 で、開発者が対話で動かす（Claude は推奨の選び方を伝える）。CLI は版を決めて動かす（`pnpm dlx shadcn@<版>`）。`@theme`・`@theme inline` に足されたトークンは、使わなければビルドで落ちる（2026-10-29 に Tailwind CSS 4.3.3 で確かめた）ので、消さなくてよい。`:root` の素の変数、`@layer base` のルール、`@font-face` は落ちずに残る。そのうち、今の見た目を変えるもの（`--font-sans`、`--radius`、`body` の色、足されたフォント）だけを差分で確かめ、今の値に戻す
- 対応事項: 色トークン（#124）は shadcn の名前にする。明るい面（backstage）を `:root` の値にし、暗い面（stage）は面の class の中で同じ名前の値を入れ替える。部品の `dark:` が stage の面で効くように、`@custom-variant dark` を stage の面の class に向ける。Tailwind v4 では `@theme inline` で CSS 変数を参照し、入れ替えが効くようにする
- 対応事項: shadcn にない、このアプリだけの色（選択肢の4色、`spotlight`、`correct`、`alert`）も、`<名前>` と `<名前>-foreground` の組にそろえる。今の `on-choice` などは、#134 で消すまで別名として残す
- 対応事項: 文字・余白・フォーカスリング（#125）は、デジタル庁デザインシステムの値を手本にする。フォーカスリングは、shadcn の `focus-visible:ring-3 ring-ring/50` を、黒（暗い面では明るい色）の outline 4 px と、その内側の黄の ring 2 px の二重に書き換える。投影の `vw` のトークンはそのまま残す
- 対応事項: コピーした部品の動き（`tw-animate-css` の fade・zoom）は外し、`tw-animate-css` は入れない。動きは最速正解者と優勝の発表の1か所だけにする決まり（`docs/design/README.md`）を守るため
- 対応事項: ホストの確認（#133）は、残り時間が見えるままにする。shadcn の AlertDialog はモーダルなので、ホストの確認に使うか、その場に出す今の形を部品にするかは #133 で決める
