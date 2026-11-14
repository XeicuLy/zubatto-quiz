# 画面の仕組み

`apps/web`（SPA と、`/api/*` を転送する画面の Worker）が、どう動き、どこに何があるかをまとめる。決めた理由の大もとは [ADR 0006](../adr/0006-spa-and-api-worker-layout.md) と [ADR 0007](../adr/0007-ui-components-approach.md) にあり、ここには ADR に書いていない約束と、コードのどこで守っているかを書く。

コードを書くときに守る約束は、[CLAUDE.md](../../CLAUDE.md) に1行ずつ残している。この文書はその説明で、見出しを変えるときは CLAUDE.md のリンクも直す（docs-check が確かめる）。要件の ID（`S1` など）は[要件定義書](../requirements/zubatto-quiz.md)で引く。部屋の DO やメッセージの側の話は [backend.md](backend.md) にある。

## 全体の形

- 素の Vite の SPA（`index.html` + `src/main.tsx`）で、TanStack Router のファイルルートを使い、TanStack Query をルーターのコンテキストに置く。Tailwind CSS v4 のトークンは `src/styles.css` の `@theme` に書き、`tailwind.config.js` は使わない
- フォントは `@fontsource` から読む。こうすると CSP は `'self'` のままで済む
- `@/*` は `apps/web/src/*` を指す（ADR 0007）。別名を書くのは tsconfig の `paths` だけで、`tsconfig.json`（shadcn の CLI はこのファイルだけを読み、references は読まない）・`tsconfig.app.json`・`tsconfig.node.json`（`test/*.test.ts` が `@/` で src を読む）の3つに同じものを書く
- Vite と vitest は `@/` を `resolve.alias` でなく `resolve.tsconfigPaths: true` で解決する。`vite.config.ts` は `auxiliaryWorkers` で API の Worker も作るので、alias で `@` を `apps/web/src` に向けると、API の `@/` まで web を指してしまう。`tsconfigPaths` は、import する側のファイルから `tsconfig.json` の references をたどり、そのファイルを `include` する tsconfig の `paths` を使う。どの tsconfig にも入っていないファイルでは `@/` が解決されない。`vitest.config.ts` は `vite.config.ts` を読まないので、両方に書く
- 親のフォルダーのファイルは `@/` で読み、`../` は使わない。`apps/*/src/` では oxlint の `import/no-relative-parent-imports` が止める。同じフォルダーの `./` はよい。テストのコードはこのルールから外す。`src/` のテストが `test/` の道具（`fake-api` など）を読む import は `@/` で書けないので、`../../../test/...` のまま。`test/` から `src/` を読むときは `@/` を使う。`packages/*` と `tools/*` は相対パスのまま（ADR 0007）
- `src/` は層に分かれ、import の向きは `routes/` → `features/` → `shared/` → `api/`・`realtime/` の一方向にする。`components/ui` は `lib/`（`cn`）と自分のほかを読まない。`.oxlintrc.json` の `overrides` が、層ごとの `no-restricted-imports` で逆向きを止める。止めるのは次の import で、`../` は上の `import/no-relative-parent-imports` が止めるので、`@/` の形だけを書いている

  | 層                  | 読まないもの                                     |
  | ------------------- | ------------------------------------------------ |
  | `features/*`        | ほかの feature（`@/features/**`）、`routes/`     |
  | `shared/`           | `features/`、`routes/`                           |
  | `api/`・`realtime/` | `features/`、`shared/`、`components/`、`routes/` |
  | `components/ui`     | `lib/` と `components/ui` のほかのすべて         |
  - 2つの feature で使うものは `shared/` へ移す。feature の中は `./` で読む。feature の中にフォルダーを作ると `@/features/<自分>/…` も止まるので、そのときは feature ごとの上書きに分ける
  - 上書きは全体の `no-restricted-imports` を丸ごと置き換えるので、層の上書きには、全体の禁止（テストのコード・ストーリーと Storybook・`@base-ui/*`・`paths`）を書き写している。全体を直したら、4つの上書きも直す。上書きは後に書いたものが勝つので、テストのコードを外す上書きは最後に置く
  - `import/no-cycle` はリポジトリ全体で、読み合うモジュールを止める。`@/` も tsconfig の `paths` で解いてたどる
  - どれも `tools/docs-check/test/oxlint-layers.test.ts` が、一時フォルダーに設定の写しとわざと違反するファイルを置いて oxlint を走らせ、確かめる

- `src/routeTree.gen.ts` は、ルーターのプラグインが `vite dev`/`build` と vitest のときに作る。コミットする。oxfmt と oxlint は飛ばす。`src/routes/` の中のテストのファイルは `routeFileIgnorePattern` で外す。これは `vite.config.ts` と `vitest.config.ts` の両方に書く
- `vitest.config.ts` は `vite.config.ts` を読まない。Cloudflare のプラグインが Workers を起こしてしまうため
- React Compiler は Babel のプラグインとして動かす。`@vitejs/plugin-react` 6 は Babel を内蔵せず、`react({ compiler: true })`（Rust 版）はまだ実験中なので使わない。設定は `react-compiler.ts` の `reactCompiler()` 1つにまとめ、`vite.config.ts` と `vitest.config.ts` の `react()` のすぐ後ろで呼ぶ。片方だけ変えると、本番とテストで違うコードが動くため
  - 変換がかかるのは画面の環境（`consumer` が `client`）だけで、同じ Vite で作る API と画面の Worker にはかからない。`src/routeTree.gen.ts` は部品がないので外す
  - `@babel/core` は 7 系のままにする。8 系では、`{ size = 'md' }` のように既定値を付けた props を持つ部品を Compiler が読めず、エラーなしで飛ばす。ビルドもテストも通るので、効果がなくなったことが見えない（2026-11-05 に Babel 8.1.0 と Compiler 1.0.0 で確かめた）。`src/lib/react-compiler.test.tsx` は、既定値付きの部品の描画回数で、この変換が vitest で動いていることを確かめる
  - `useMemo`・`useCallback`・`memo` は手で書かない。Compiler は手書きのものも尊重するので残っていても動くが、残すと「書くべきなのか」が読み手に分からなくなる。計算し直さないことが大事な部品は、計算の回数をテストで確かめる（`JoinQrCode.test.tsx`。`encode` の回数を数える）
- DOM と Workers の型がぶつかるので、tsconfig を3つに分ける。`tsconfig.app.json`（DOM、`src/`）、`tsconfig.worker.json`（`src/server.ts` とそのテスト、Workers の型）、`tsconfig.node.json`（設定ファイルと `test/*.test.ts`）。ファイルを読むテストは `// @vitest-environment node` で node で動かし、`test/` に置く
- `vite dev` は `auxiliaryWorkers` で2つの Worker を両方動かす。API の Worker の設定は `api-worker.ts` が返し、`vite dev` のときだけ入口を Swagger UI を足した `apps/api/test/dev-entry.ts` に替える（[testing.md の「Swagger UI で HTTP API を試す」](testing.md#swagger-ui-で-http-api-を試す)）。`apps/web/wrangler.jsonc` か `src/server.ts` を変えたら、次で型を作り直す

  ```sh
  pnpm --filter @zubatto-quiz/web run types
  ```

## XSS を防ぐ

回答者の秘密は localStorage に置く（[ADR 0004](../adr/0004-player-identification-and-reconnection.md)）。XSS が起きると、HttpOnly の cookie にしても、開いている WebSocket から本人として回答できてしまう。そのため、ここでは HttpOnly のかわりに、XSS そのものを起こさない対策で守る。

- CSP は `script-src 'self'` で、`apps/web/public/_headers` に書く。`apps/web/index.html` には、インラインのスクリプト・スタイル・イベントハンドラを置かない。`test/static-files.test.ts` が両方のファイルを確かめる
- `_headers` が効くのは `vite build`/`vite preview`/デプロイだけで、`vite dev` では効かない。Worker の応答（`/api/*`）にも効かない
- 問題文もただの文字列として扱う。F5 は Markdown だったが、改行だけに変えた（#44）。`question.text` は JSX の文字としてそのまま描き、Markdown として読んだり、改行で `<br>` に分けたりしない。こうすると、利用者の入力が要素になることはない
- 改行は、`question.text` を出す要素にすべて付けた `whitespace-pre-line` で見せる。これは空白と改行の見せ方を決める CSS で、XSS を防ぐのは上の「文字のまま描く」ほう
- 利用者が入れた名前に、`innerHTML` のような API を使わない。oxlint が `dangerouslySetInnerHTML` と `innerHTML` のような DOM の API を断る

## 検索エンジンに載せない

本番の URL は公開されているが、検索から部屋の参加画面やログイン画面に来ても使い道がない。そのため、全ページを noindex にする（#284）。

- `apps/web/public/_headers` の `/*` に `X-Robots-Tag: noindex, nofollow` を書く。CSP と同じブロックなので、静的アセットの応答すべて（ない URL に返す SPA の `index.html`、画像、JS、CSS）に付く。`/*` のブロックを2つに分けない。`test/static-files.test.ts` は `/*` の行で分けて読んでいる
- `apps/web/index.html` にも `<meta name="robots" content="noindex, nofollow" />` を書く。ヘッダーを読まない経路への保険
- `/api/*` は Worker の応答なので `_headers` が付かない（ADR 0006）。API は JSON と WebSocket だけで、ページとして載ることはないので、付けない
- `robots.txt` の `Disallow: /` は使わない。クロールを止めると、クローラーが noindex を読めなくなり、ほかのサイトからのリンクで URL だけ載ることがある。`public/robots.txt` がないことも `test/static-files.test.ts` が確かめる
- `vite dev` では `_headers` が効かない。確かめるときは `e2e:serve` に `curl -sI` を送る

## 色の役割

- 色の役割は shadcn の名前（`background`/`foreground`、`card`、`primary`/`primary-foreground`、`muted`、`destructive`/`destructive-foreground`、`border`、`input`、`ring`…）にそろえる（#124、ADR 0007）。どれも `@theme inline` の項目で、中身は `:root`（明るい管理画面）と `.stage`（暗いステージ）に置いた素の変数。そのため `bg-primary` は `var(--primary)` をそのまま読み、`.stage` の中では値が入れ替わる。`@custom-variant dark` も `.stage` を指す。`.stage` は画面の route の外枠に付ける。ホストの画面（`routes/rooms/$roomId/host.tsx`、`host.test.tsx` が確かめる）と回答者の画面（`routes/r/$roomId.tsx`）に付いている
- アプリだけの色は `<name>` と `<name>-foreground` の組にする（`choice-1`…`4`、`spotlight`、`correct`、`alert`）。`alert` はステージのお知らせの帯で、エラーと危ない操作には `destructive` を使う
- 前の名前（`stage*`、`backstage*`、`on-*`、`alert-strong`）は #134 で消した。Tailwind は知らない class を黙って捨てるので、画面に書き戻しても色が抜けるだけで、型もほかのテストも落ちない。`test/color-roles.test.ts` が、src の画面のファイルにその名前があると落ちる。暗い面の印の `.stage` と、投影の大きさの `text-stage-*`・`p-stage` は残る名前で、数えない
- 暗い面の一段明るい紺は、`card`・`secondary`・`muted`・`accent` が今は同じ値。値でなく役割で選ぶ。囲み（参加用 URL の箱、あなたの位置、ランキングの行）は `card`、名前のチップは `secondary`、押せなくなった選択肢や時間のバーの溝は `muted` と `muted-foreground`
- 色を反転させて目立たせるもの（ランキングの自分の行、QR の白い板、時間のバー）は `bg-primary text-primary-foreground`、その中の「あなた」は `bg-primary-foreground text-primary`。選択肢のパネルの上の番号の丸の影は `bg-background/25`（パネルは暗い面にしか出ない）
- 文字と背景の組は、投影でもスマホでも 4.5:1 以上にする（ADR 0007）。`test/contrast.test.ts` が、組の表（`<name>-foreground` と `<name>`、面ごとの `foreground` と `background` など）のコントラストを、コンパイルした CSS の値から計算する。計算は oklch → OKLab → 線形 sRGB → 相対輝度で、依存は増やさない。sRGB の外の色は、sRGB の画面では切り詰められ、P3 の画面ではそのまま出て明るさが変わるので、2通りに測って低いほうを見る。新しい組を作ったら表に足す。実際の画面は、E2E の axe の `color-contrast` でも確かめる（[testing.md](testing.md#アクセシビリティの自動チェック)）。どのトークンをどこで使うかの一覧は [docs/design/README.md](../design/README.md#トークンの一覧と使い分け) にある
- 選択肢の白い文字が 4.5:1 に届くよう、`choice-1`〜`3` は文字ではなく背景を暗くした（#126）。番号がいつも出ているので、4色の見分けは番号でもできる。どれも sRGB の中に収まる値にしてある

## 文字と余白とフォーカス

値は、デジタル庁デザインシステムを 2026-10-30 に確かめたもの（#125、ADR 0007）。

- 字体は2つ。飾り文字の Dela Gothic One は、投影の数字・順位の `font-numeral` とロゴの `font-logo` だけに使う。ほかは本文の M PLUS 1 で、見出しは `font-bold` で太くする。入力欄は親の字体を受け継ぐので、ラベルに飾り文字を付けると入力と字体がずれる。`font-numeral` は数字だけを包み、「第」「問」「秒」「位」「点」「人」などの単位と記号は外の `font-bold`（M PLUS 1）で出す。`shared/results/` の部品は、variant の対応表で投影のときだけ `font-numeral` を渡す。`test/font-roles.test.ts` が、使ってよいファイルを確かめる
- Dela Gothic One は太さ 400 しかなく、`font-bold` の中ではブラウザが字を太らせて潰す。`@layer base` の `html { font-synthesis-weight: none }` がこれを止める。M PLUS 1 は可変フォントで本物の太さを持つので、影響しない
- 文字の大きさは役割で選ぶ。`text-verdict`/`display`/`title`/`lead`/`heading`/`body`/`note`/`label`（どれも大きさ・行の高さ・字間をまとめて決める）を使い、`text-lg` は使わない。行の高さはトークンが決めるので、`leading-*` を重ねない。どの役割をどこで使うかは [docs/design/README.md](../design/README.md#文字) の表にある。`test/text-roles.test.ts` が、画面のファイル（テストとストーリーを除く）に `text-xs`〜`text-9xl` がないことを確かめる。正規表現は class の切れ目で区切るので、`text-stage-label` などの役割の名前には当たらず、`md:text-xl` や `text-xl/7` には当たる。コメントの中の文字にも当たるので、コメントでも大きさの名前は書かない。vw の `text-stage-*`/`p-stage` のトークンは、プロジェクターに映す画面だけで使う
- 足した3つの段は、`text-2xl` より大きかった場所から決めた（#272）。`text-verdict`（64px）は ① の正誤だけ、`text-display`（48px）は1行の大きな数とロゴ、`text-lead`（24px）は回答者画面の問題文と文の中の数。`text-display` は1行で出すので、手本の 140% では上下が空きすぎ、120% にした
- 余白は、ものどうしの関係で名前を付ける。`related`/`item`/`cluster`/`section`（8/16/24/64 px）。`--spacing-md` のような大きさの名前は足さない。足すと `max-w-md` がそれを読んでしまう
- `@layer base` の `:focus-visible` が、`--ring` の 4 px の outline を 2 px 離して描き、その間を `--color-focus`（Yellow-300）の `ring-2` で埋める。この ring は Tailwind の影の変数を通るので、`shadow-panel` と重ねられる
- スクリプトだけでフォーカスを当てる要素（ホストの操作のあとの、映している見出し）には `focus-target` を使う。`outline-none` では黄色の ring が残るため
- 要素ごとの `focus-visible:outline-*` のクラスは、これを上書きしてしまう。`components/ui` の部品は持たないので、部品に置き換えると消える。まだ部品になっていないところ（下線のリンク、回答者の早押しのパネルなど）は、置き換えるまで残る

## shadcn と cn

- `shadcn init`（CLI 4.22.1、`base-nova`）は1回だけ動かした。見た目を変えるものは取り除いた。Geist と `--font-sans` の上書き、`--radius-*`、`tw-animate-css`、`*` への `@layer base` のルール（`border-border outline-ring/50` はブラウザの既定のフォーカスリングの色を変えてしまう）、`body` と `html` のルール、チャートとサイドバーの色。`lucide-react` も外した。`@base-ui/react` と `class-variance-authority` は、`components/ui` の部品が使う（[UI の部品](#ui-の部品)）。Geist、radius の上書き、役割の色を全体に当てるルールが戻ると、テストが落ちる
- `shadcn` を devDependency に入れているのは、`@import 'shadcn/tailwind.css'`（`data-open:` のようなバリアント）のためだけ。その中の8つの `@property` のルールと、`.shimmer` の動きを減らすルールはいつも出力に入り、残りは使ったときだけ入る
- `cn` は `src/lib/tailwind.ts` にある（`cn/config` の `createCn`。`components.json` の `utils` の別名もここを指す）。色とフォントでない `@theme` の名前は、すべて `createCn` に教える。教えないと、`cn('text-stage-label', 'text-foreground')` が文字の大きさを落としてしまう。`test/cn-theme.test.ts` が styles.css から名前を読むので、新しい `@theme` の名前は、`tailwind.ts` に並べるまでテストが落ちる
- oxfmt が Tailwind の class を並べ替えるのは、`className` の文字と、`cn`・`cva` の引数の文字（`.oxfmtrc.json` の `sortTailwindcss.functions`）だけ。定数に入れた文字は並べ替えないので、部品の class は定数にまとめず、呼び出しの中に書く（`Input` と `Textarea` は同じ枠の class を別々に持つ）。並べ替えの基準は `apps/web/src/styles.css` なので、前の名前のまま残すデザインのモック（`docs/design/mock/*.html`）は、`ignorePatterns` で整形から外している
- 試しに作ったプロジェクトでは、`init` が書いた `button.tsx` が `cn` を `cn` から直接 import していた。そういう import は `@/lib/tailwind` に向け直す
- `@source not` で `test/` と `*.test.*` を Tailwind の読み取りから外している。こうすると、テストの表に書いたクラス名が出力に入らない（`animate-spotlight-in` は、`styles.test.ts` に名前があったせいで出力に入っていた）
- vitest は、CSS の import をすべて（`?raw` も）`''` に変える。styles.css は、`test/` の node のテストで `node:fs` を使って読む

## UI の部品

画面で使うボタンなどの部品は `src/components/ui/` に置く。shadcn/ui の Base UI 版のひな形をもとにし、このアプリの決まりに合わせて書き換えた（ADR 0007）。

- 画面は `components/ui` の部品だけを使い、`@base-ui/*` を直接 import しない。`.oxlintrc.json` の `no-restricted-imports` が `apps/web/src/components/ui/` の外からの import を止める。土台を替えるときは、`components/ui` の中だけを直せばよい
- ひな形は `pnpm exec shadcn add <名前> --view`（`apps/web` で、CLI 4.22.1）で見て、手で書き写す。`add` をそのまま動かすと、依存を足し直したり、`cn` を `cn` から import したりする
- ひな形から外すもの: フォーカスの class（`outline-none`、`focus-visible:ring-3 ring-ring/50` など）。`styles.css` の `:focus-visible` が面ごとの二重の枠を出すので、部品が上書きすると崩れる。`transition-all` も外す。動きは最速正解者と優勝の発表の1か所だけにする決まりのため。`button.test.tsx` が、どの variant と size にもフォーカスの class がないことを確かめる
- 色は役割の名前（`bg-primary` など）だけで選び、面（明るい・暗い）は variant にしない。`.stage` の中では同じ名前の値が入れ替わるので、同じ部品が両方の面で使える

`Button`（`button.tsx`）:

- `variant` は shadcn の名前にそろえ、使うものだけを残した。`default`（画面でいちばん押してほしい操作）、`outline`（それと並ぶ別の操作）、`destructive`（消すなど戻せない操作）、`link`（目立たせない操作。危ない操作には `className="text-destructive"` を足す）
- `size` は `sm`（一覧の行の中など、いくつも並ぶ場所）、`default`、`lg`（画面に1つの大きな操作）。高さを決め、文字は1行の `text-label`（`sm` は `text-note`）にする
- `stage` の size は、プロジェクターに映す画面（ホストの待機画面の「URL をコピー」）だけで使う。文字は vw で伸びる `text-stage-label` で、高さと余白は `default` の比を em で写した `h-[2.75em] px-[1.25em]`。rem で決めると、投影では文字だけが大きくなって詰まる
- `link` の `sm` は左右に余白（`px-4`）を持つ。並べるときは `gap` を足さず、その余白で間をとり、並びの箱に `-mx-4` を付けて文字の端を見出しや帯の余白にそろえる（ホストの操作バーのやり直し・終了・音、問題の上へ・下へ・消す）
- 置く場所で見た目を変える部品（`SoundToggle`）は、`Button` の `variant`・`size`・`className` をそのまま受け取って渡す
- 角はすべて `rounded-full`。早押しパネルの厚み（`shadow-panel` と、押すと沈む `active:translate-y-1.5`）は、cva の `compoundVariants` で `default` × `lg` だけに付ける。目立たせるのは、その画面の大きな主の操作1つにする
- `outline` の枠は `border-foreground`。文字でない枠も、隣の色に 3:1 以上にする（ADR 0007 のデジタル庁デザインシステムの値）。`border` の色では、どちらの面でも届かない
- `type` は Base UI が既定で `"button"` を付ける。フォームを送るボタンだけ `type="submit"` を渡す
- アイコンは文字と並べて子に置く。`svg` は文字の 1.25 倍の大きさになり（`size-*` を付けたものはそのまま）、文字との間は `gap-related` でとる。アイコンは `aria-hidden` にし、ボタンの名前は文字だけにする
- ブランドのロゴは `src/components/icons/` に、ライセンスのはっきりした配布元の SVG の path をそのまま JSX で置く。`lucide-react` は 1.0 でブランドのロゴを消した（2026-10-31 に確かめた）。GitHub のロゴ（`github-mark.tsx`）は Simple Icons の `github.svg`（CC0-1.0）で、著作権表示が要らない。MIT のもの（Primer Octicons など）を写すときは、著作権表示と許諾文もファイルに入れる。`fill="currentColor"` で文字の色に合わせる。simpleicons.org などから実行時に読み込むと CSP で止まるので、path を写す。インラインの SVG は `<style>` でも `style` 属性でもないので、CSP は変えなくてよい
- `<Link>` をボタンの見た目にするときは、`className={buttonVariants({ ... })}` で class だけを渡す。`Button` の `render` で `<a>` を描かせると `role="button"` が付き、リンクとして読まれなくなる

`Field`・`Input`・`Textarea`（`field.tsx`）:

- `Field` は `label`・`hint`・`error` を受け取り、`useId` で作った id で、ラベル・入力欄・ヒント・誤りをつなぐ。画面は `id` も `aria-invalid` も `aria-describedby` も書かない。つなぎは context で渡し、`Field` の中の `Input` と `Textarea` が受け取る。`<div>` で包んでも届くので、単位（「秒」）と横に並べてよい。どちらもつなぎを props のあとに広げるので、画面から `id` を渡してもラベルとのつなぎは崩れない
- 誤り（`error`）があれば `aria-invalid` にし、ヒントのかわりに誤りを `role="alert"` で出して `aria-describedby` で指す。なければヒントを指す。`error` は文字だけを受け取り、文字として描く（入れた名前が入ることがある。ADR 0004）
- shadcn/ui の `field` のひな形は、組み合わせる部品を並べるだけで id をつながないので、写していない。Base UI の `Field` も使わない。外から決めた誤りを出すには `Field.Error` に `match` を渡す必要があり、検証と出し入れの状態も持ち込むため。このアプリは protocol のスキーマで確かめて、誤りの文字を渡すだけ
- `Input` と `Textarea` は `Field` の外でも、ふつうの `<input>`・`<textarea>` として使える（ラベルを見せず `aria-label` で名付ける欄。問題の編集画面の選択肢）。そのときは id も aria-* も付けないので、誤りをつなぐなら画面が `aria-invalid` と `aria-describedby` を書く
- `Textarea` は `Input` と同じ枠と色で、shadcn のひな形の `field-sizing-content` を残し、打った行の分だけ高くなる（効かないブラウザでは `rows` の高さ）
- 入力欄の枠は `border-muted-foreground`、誤りのときは `aria-invalid:border-destructive`。`border-input` は、どちらの面でも背景に 3:1 に届かない（明るい面で 1.35:1、暗い面で 1.64:1）。`test/contrast.test.ts` が、枠と隣の色の 3:1（WCAG 2.2 の 1.4.11）を確かめる
- 色は役割の名前で選ぶので、暗い面に置くときは、外側に `.stage` が要る。回答者の画面は `routes/r/$roomId.tsx` の外枠が付ける

`Card`（`card.tsx`）:

- ひとまとまりの知らせや内容を囲む面。`rounded-panel border-2 bg-card p-5 text-card-foreground` で、枠の色を `variant` で選ぶ。`default`（`border-border`）と `destructive`（誤りの知らせ。`border-destructive`）
- shadcn/ui の `card` のひな形から、`Card` 本体だけを写した。`CardHeader`・`CardTitle` などは写していない。中身の見出しは画面ごとに要素（`<p>`・`<h1>`）も大きさも違うので、画面が書く
- `role` は画面が渡す。誤りの知らせなら `role="alert"`。外側の余白（`mt-8` など）も `className` で渡す
- 置き換えたのは、class がそろっていた誤りの知らせ（ログイン画面と、問題セットの一覧と編集画面の読み込みの失敗。後者はいま `LoadErrorCard` の中にある）だけ。一覧の `<ul>`（1px の枠と `divide-y` で行を区切る）、空のときの点線の枠、問題の編集のカード（誤りで枠の太さが変わる）は形が違うので、まだ `Card` にしていない

`ConfirmDialog`・`useConfirm`（`confirm-dialog.tsx`）:

- 戻せない操作の前の確かめ。ホストのやり直しと終了、問題セットを消す、保存せずに編集画面を離れる、の3つがこれを使う（#133）
- shadcn/ui の `AlertDialog` は使わない。モーダルで画面を覆うので、ホストの確認のあいだ残り時間が見えなくなる（ADR 0007）。開いたボタンや帯の場所に、その場で出す。`window.confirm` も、残り時間と接続を止めるので使わない
- 画面が渡すのは `title`（`alertdialog` の名前）・`detail`（説明）・`confirmLabel`・`onConfirm`・`onCancel`。やめる側の名前は `cancelLabel`（既定は「やめる」）、ボタンの大きさは `size`（置く場所に合わせて、ホストは `lg`、一覧の行は `sm`）で変える。確定はいつも `destructive`
- 開いたら、やめる側のボタンにフォーカスを当てる（ref を使い、`autoFocus` は使わない）。Esc で `onCancel` を呼ぶ（`alertdialog` の `onKeyDown` が、中のボタンから上がってくるものを受ける）
- `pending`（一覧で消しているあいだ）は、両方のボタンを押せなくし、Esc も受けない。`disabled` 属性ではなく Base UI の `focusableWhenDisabled` で `aria-disabled` にする。`disabled` 属性だと、押したボタンからフォーカスが `body` へ落ち、失敗したときに居場所がなくなるため。薄く見せるのは `aria-disabled:opacity-50`（Tailwind の `disabled:` は `:disabled` を見るので効かない）
- 閉じたときのフォーカスの戻し方は2つある。開いたボタンと置き換えて出すとき（ホストの帯、一覧の行）は、`useConfirm` を使う。`open(which, ref)` で開いたボタンの ref を覚え、閉じて描き直したあとに、その ref が指す新しいボタンへ戻す。開いたボタンが残るとき（編集画面の「問題セットの一覧に戻る」）は、`ConfirmDialog` が開く前の `document.activeElement` を覚えていて、閉じたときにまだ画面にあれば戻す。置き換えるときは、開いたボタンがクリックと同じ描画で外されるので、覚えた要素は `body` になり、2つがぶつかることはない
- `useConfirm` は、作り直した直後には何も開いていないので、作っただけではフォーカスを動かさない。ホストの帯は段階ごとに key で作り直し、フォーカスは `HostPage` が見出しへ移す

`Toaster`・`toastManager`（`toast.tsx`）と `notify`（`shared/feedback/notify.ts`）:

- 成功を知らせる toast（#287）。いま使うのは、一覧で問題セットを消したときの「「〇〇」を消しました」。失敗には使わない。失敗は消えずに、原因の近くに残す
- shadcn/ui の `sonner` は使わない。読み込み時に `document.createElement('style')` を `<head>` に差し込み、CSP（`style-src` がなく `default-src 'self'` が効く）に止められる。ADR 0007 の Radix の Dialog と同じ理由。Base UI 1.9.0 の `toast/` には `<style>` を作るコードがなく、位置などの値は React の `style` prop（CSSOM）で入るので止められない。`e2e/csp.spec.ts` が、問題セットを消して toast を出し、CSP の違反がないことと `<style>` 要素が0件のままであることを確かめる
- `shadcn add toast --view`（Base UI 版）を写し、次を外した。重ねて縮める動きと `transition`（動きは1か所だけの決まり。縦に並べ、上限の3つを超えた古いものは `data-limited:hidden` で隠す）、フォーカスの class、閉じるボタン・アクション・説明（成功の知らせは待てば消え、文は題1つで足りる）、アイコンの `lucide-react`（入れていない。印はインラインの SVG）
- 題（`Toast.Title`）は `render={<p />}` で `<p>` にする。Base UI は既定で `<h2>` を描き、toast が出るたびに画面の見出しの並びに知らせが混ざる。toast（`role="dialog"`）の名前には `aria-labelledby` で変わらずなる
- `Toast.Portal` は使わない。`<body>` の直下に描くと、Storybook の `.stage` の箱の外に出て暗い面の色が当たらない。Viewport は `fixed` なので、`__root` の末尾に置けば同じ場所に出る
- 位置は、スマホの幅では下に幅いっぱい（両端は余白）、`sm` 以上では右下。色は `bg-primary` と `text-primary-foreground` で、枠を持たないので、面そのものが下の画面の `background`・`card` に 3:1 以上になることを `test/contrast.test.ts` が確かめる
- `Toaster` は `__root` の `Announcer` の隣に置く。経路の外にあるので、保存して一覧へ移るときも toast は消えない
- 画面は `toastManager` を直接触らず、`notify(message)` を呼ぶ。`notify` は hook ではないので、mutation の `onSuccess` からそのまま呼べる。消えるまでの時間は `notifyTimeoutOf` が文の長さで決める（最低 6 秒、1文字 150 ms。WCAG 2.2.1）。hover とフォーカスのあいだは止まり、Esc で閉じる（どちらも Base UI が持つ）。読み上げは[読み上げ](#読み上げ)の節
- テストでは `setup.ts` が、テストのたびに `toastManager.close()` で全部閉じる。manager はモジュールに1つなので、消えるまでの timer を次のテストに残さない。ストーリーは、ストーリーごとに `createToastManager()` で manager を作って `Toaster` に渡し、`useEffect` から `timeout: 0` で1つ出す。Provider は `useEffect` で manager を購読し、子の effect は親より先に走るので取りこぼさない（`useLayoutEffect` だと購読の前に出して消える）

`ActionError`・`LoadErrorCard`・`describeApiError`（`shared/feedback/`）:

- 失敗の知らせ（#288）。toast にせず、次の操作か読み直しまで消えない `role="alert"` で、原因の近くに残す。入力の誤り（欄の下と保存の帯の要約）は `Field` と `errorSummaryOf` のままで、これらは使わない
- `describeApiError(error)` は投げられた値を `unauthorized`（401）・`notFound`（404）・`conflict`（409）・`unavailable`（5xx と、fetch が届かなかったときの `TypeError`）・`other`（400・403、応答の形が違う `ZodError`、ログアウトの失敗など）に分ける純粋な関数。分けるのは状態コードだけで、同じ状態コードの中を本文の `code`（`ApiError.code`）で分けるのは呼ぶ側が決める。画面は `ApiError` の `status` を直接見ず、これを通す
- `ActionError` は、操作（保存・作る・部屋を作る・消す・ログアウト）のボタンのそばに出す `<p>`。文は呼ぶ側が渡す。`failed` は必ず渡し、「〇〇できませんでした。もう一度押してください。」のように、やり直し方まで書く（`conflict`・`unavailable`・`other` はこれを出す）。401 は既定で「ログインが切れました。ログインし直す」（同じタブの `/login`）を出し、`unauthorized` で差し替えられる。問題セットの編集は下書きを持つので、`LoginLink newTab` で別のタブに開く（このタブで GitHub へ移ると下書きが消える。Cookie はタブで共有される）。404 は `notFound` を渡せばその文、なければ `failed`。404 で何も出さない（一覧を読み直して行が消える）ときは、呼ぶ側が描かない
- `LoadErrorCard` は、画面の中身を読めなかったときに中身の場所に出す `Card`（`destructive`）。問題セットの一覧（`titleAs="p"`、画面の `h1` の下）と、編集画面のルートの `errorComponent`（`titleAs="h1"`、カードが画面の中身のすべて）が使う。401 は「ログインし直す」、`notFound` を渡した 404 は見出し・説明・戻るリンク、ほかは `failed` の見出しと「もう一度読む」（`retry`。query なら `refetch`、loader なら `router.invalidate`）
- `error` はどちらも `unknown` で受ける。ルートの `errorComponent` の `error` が `unknown` なので、そのまま渡せる
- どちらも `<Link>` を含むので、部品のテストは `test/render-in-router.tsx` の `renderInRouter` で、根のルートだけの router の中で描く。Storybook には router がないので、ストーリーは置かない

## Storybook

props だけで見た目が決まる表示部品を、Storybook の autodocs（props の表とストーリーの一覧）で目録にする。手元で起動して見るもので、公開しない。振る舞いは部品のテストと E2E で確かめ、ストーリーは見た目の目録と煙テストにとどめる。play 関数、`@storybook/addon-vitest`、`@storybook/addon-a11y` は入れない。

- 起動は次のどちらか。`storybook:build` は `apps/web/storybook-static/` に書き出す（gitignore してある）

  ```sh
  pnpm --filter @zubatto-quiz/web run storybook
  ```

  ```sh
  pnpm --filter @zubatto-quiz/web run storybook:build
  ```

- ストーリーは部品の隣に `<部品>.stories.tsx` として置く（`components/ui/button.stories.tsx`）。書き方は CSF 3 で、`const meta = { component } satisfies Meta<typeof 部品>` と `StoryObj<typeof meta>` を使う。`preview.tsx` が全体に `tags: ['autodocs']` を付けるので、ストーリーごとには書かない
- `.storybook/main.ts` は `viteConfigPath` で `.storybook/vite.config.ts` を読み、`apps/web/vite.config.ts` は読まない。Cloudflare のプラグインが画面と API の Worker を立ち上げ、ルーターのプラグインが `src/routeTree.gen.ts` を書き換えるため。別の設定には、部品を描くのに要る `react()`・`reactCompiler()`・`tailwindcss()` と `resolve.tsconfigPaths` だけを写す。`react()` と `reactCompiler()` の順は本番と同じにし、本番と同じ変換のコードを見る。利用状況の送信（telemetry）は `core.disableTelemetry` で切っている
- 面（明るい・暗い）は、ツールバーの「面」（`globals.surface`、`admin` か `stage`）で切り替える。`preview.tsx` のデコレータが、`stage` のときだけストーリーを `.stage` の箱で包み、背景と文字の色を付ける。部品は面を variant に持たないので（[UI の部品](#ui-の部品)）、暗い面で見せたいストーリーはストーリーの中で包まず、`globals: { surface: 'stage' }` を書く
- 画面の大きさは、`preview.tsx` の `parameters.viewport.options` に名前で並べる。`variant` を持つ部品は、`mobile`（回答者画面、390×844）か `projector`（進行画面の投影、1920×1080）を `globals: { viewport: { value: 'mobile', isRotated: false } }` で選ぶ。docs のページはストーリーをページの中に描くので、大きさは当たらない
- 描いたときにフォーカスを動かす部品（`ConfirmDialog` など）は、meta に `parameters: { docs: { story: { inline: false, height } } }` を書き、docs のページではストーリーごとに iframe で描く。ページの中に並べると、最後のストーリーがフォーカスを取り、docs のページが下まで流れる（2026-11-08 に Storybook 10.6.6 で確かめた）。`height` は、いちばん高いストーリーが iframe に収まる値にする
- ストーリーに渡す順位・秒数・点は、部屋の DO が送る形（protocol の型）の固定の値で書き、ストーリーの中では数えない。データは部品のテストと共有せず、ストーリーごとに書く。テストは期待する文とデータが近くにある方が読みやすく、ストーリーは見せたい状態（長い名前、同点、0件など）に合わせて足せるため
- 残り時間を数える部品は、数える外側と描く内側に分けてあり（`AcceptingStage` と `AcceptingStageView`）、ストーリーは内側に `leftMs` と `bar` を固定の値で渡す。棒の `transitionMs` は0にして止める
- ストアを受け取る部品（`HostControls` の `sound`）には、ストーリーの中で `zustand/vanilla` の `createStore` で状態を止めたストアを作り、メソッドは `storybook/test` の `fn()` にして渡す。本物（`createSoundPlayer`）は AudioContext と localStorage で状態が変わり、絵が決まらないため
- 描いたあとにフォーカスを動かす props（`AnswerButtons` の `focusList`）は、ストーリーでは渡さない。フォーカスと読み上げは部品のテストと E2E で確かめる
- ストーリーは本番に入れない。次の3か所で止める
  - CSS: `src/styles.css` の `@source not` で、`*.stories.{ts,tsx}` と `.storybook` を外す。Tailwind は `@source` がなくても `apps/web` の下を読むので、`.storybook` も外さないと、デコレータの class が本番の CSS に入る（2026-11-07 に、外す前の `vite build` で確かめた）。Storybook は `.storybook/preview.css` から読み、そこで `styles.css` を import してから、2つを `@source` で足し直す。足し直すときはファイルのグロブ（`'./*.tsx'`）で書く。フォルダー（`'./'`）で書くと、外したものは戻らない（Tailwind 4.3.4）
  - import: `.oxlintrc.json` の `no-restricted-imports` が、本番のコードから `*.stories.*`・`@storybook/*`・`storybook` を読むのを止める。全体と層の上書きの両方に書き、`*.stories.*` と `apps/web/.storybook/**` は、テストのコードと同じく最後の上書きで柵から外す（`tools/docs-check/test/oxlint-layers.test.ts` が確かめる）
  - 画面のファイルの一覧: `test/screen-files.ts` はストーリーを外す。部品の使い方の例を、`font-roles.test.ts`・`color-roles.test.ts` が画面の class の使い方として数えないようにする（`test/screen-files.test.ts` が確かめる）
- 本番に入っていないことは、ストーリーと `preview.tsx` にだけある class（`mt-[1234px]` など）を一時的に足して `vite build` と `storybook:build` を動かし、`dist/client` に出ず `storybook-static` の CSS に出ることで確かめた（2026-11-07）。CI では `storybook.yaml` がビルドを確かめる。必須のチェックではない（[operations.md の「ルールセット」](operations.md#ルールセット)）
- `test/stories.test.tsx` が煙テスト。`test/story-files.ts` の `import.meta.glob` で `src` のすべてのストーリーを読み、`setProjectAnnotations(preview)` で Storybook と同じデコレータと globals を当てて、jsdom に1回ずつ描く。描くときに例外を投げないこと、デコレータの箱の中が空でないこと、`globals.surface` が `stage` のものだけが `.stage` の中に描かれることを確かめる。`make check` に入る
- `test/story-files.ts` の glob は、型引数を付けずに書き、型は `as` で付ける。vitest 5 の `fsModuleCache`（既定で有効）は、変換した結果を `node_modules/.vitest-cache` に残し、glob のすぐあとに丸かっこが続くファイルだけを外す。`glob<型>(…)` と書くと、そのときのファイルの一覧が残り、足したストーリーを煙テストが描かないまま通る（vitest 5.0.5 で確かめた、2026-11-08）。node で動く `test/story-files.test.ts` が、glob の結果とディスクのファイルの一覧がそろうことを確かめる
- 型は、`.storybook/main.ts`・`vite.config.ts` を `tsconfig.node.json`、ブラウザで描く `.storybook/preview.tsx`・`test/stories.test.tsx`・`test/story-files.ts` を `tsconfig.app.json` で確かめる。`test/story-files.ts` は node のテストからも読むので、`/// <reference types="vite/client" />` で glob の型を持ち込む

## 部屋の WebSocket

- 部屋の WebSocket に触れるのは `src/realtime/` だけ。`connectRoom`（`client.ts`）は、どのメッセージも protocol の `serverMessageSchema` で decode し、読めないものは捨てる。知らないフィールドは取り除く
- つなぎ直し: `shouldReconnect`（`reconnect.ts`）は、アプリのものでないコード（1001、1006、1011…）ならいつもつなぎ直し、4xxx のうちでは `join_timeout` と `connection_limit` のときだけつなぎ直す。ほかの 4xxx では `onStatus('closed', code)` で止まる。クライアントの側で `close()` したときは、つなぎ直さない
- `reconnectDelay` は 500 ms から倍にしていき、30 s で止める。ゆらぎ（×0.5〜1）を入れる
- 待ち時間の `attempt` は、`joined`/`resumed`/`hostReady` のときだけ0に戻し、`open` では戻さない。DO は上限を超えた接続を、いったん受け入れてから 4503 で閉じて断るため
- `playerHello({ name?, token })` は、`join` を1回だけ送り、そのあと開くたびに `resume` を送る。こうすると、返事が届かなかった `join` も `resume` でつなぎ直せる。`name` がないときは `resume` から始める（保存した秘密を持ったまま再読み込みしたとき）

## 部屋のストア

- `room-store.ts` の `createRoomStore()` は、部屋ごとに1つの `zustand/vanilla` のストアを作る（全体で1つのストアは持たない）
- 純粋な関数 `applyServerMessage` が、メッセージごとに状態を決める。今の問題に関わるもの（選択肢、自分の回答、①②③）は、すべて `question` に入れ、`questionShown` で置き換える。別の `questionId` のメッセージは古いものとして捨てる
- `joined`/`resumed`/`hostReady` は `room` を置き換え、`questionIndex` が違えば `question` を捨てる

## 接続を開く場所

- 部屋の接続は、ルーティングと利用者の操作に結びつけ、`useEffect` には結びつけない。StrictMode が、DO へ捨てるための接続を開いてしまうため。コンポーネントは zustand のストアを描くだけにする
- `/r/$roomId` の `beforeLoad` は、ID が protocol の `roomIdSchema` に通らなければ `notFound()` を投げる。`loader` は、訪れるたびに1つの `createPlayerRoom`（`features/player/player-room.ts`）を作る（`gcTime: 0`、`shouldReload: false`）。`onEnter` は `resumeSaved()` を、`onLeave` は `leave()` を呼ぶ
- 「参加する」の送信が `join(name)` を呼ぶ。そのため、接続は名前を入れたあとで開く（ADR 0004 の、未確認の接続の 10 s のタイムアウトのため）

## 回答者の参加

- `player-room.ts` の `join` は、つなぐ前に秘密を作って保存する（`token-storage.ts`、キーは `zubakui:room:<roomId>:token`）。`join` か `resumeSaved` のたびに、`connect` が新しい部屋のストアを作る。自動のつなぎ直しは `connectRoom` の中でソケットを開き直すだけで、同じストアを使い続ける
- `rejectionOf` は、秘密がもう役に立たない閉じ方（`name_taken`、`resume_failed`、`room_full`、`room_not_found`）を選ぶ。そのときは秘密を消し、純粋な関数 `entryAfter` が次の入口を選ぶ。前の2つなら名前の入力欄、あとの2つなら `full`/`not_found` の画面
- `replaced` と `room_ended` は秘密を残し、部屋の画面にとどまる。`ConnectionNotice` がそれを出す
- localStorage が例外を投げたら、秘密はメモリにだけ置き（`persisted: false`）、`WaitingRoom` が「再読み込みすると戻れない」と知らせる

## 部屋の終わり

- `shared/results/room-end.ts` の純粋な関数 `roomEndOf(state)` が、`room_ended` で閉じたあとに残ったストアを読み、次の3つに分ける。`after_final`（段階が `final` で `finalRanking` がある）、`midway`、`not_entered`（`room === null`。再読み込みしたか、遅れて来て DO に `room_ended` で断られたので、どこで終わったかが分からない）
- `after_final` では、`ConnectionNotice`（最終順位の上の帯）と `HostPage`（`HostControls` のかわりに `HostEndedBar`）のどちらも最終順位を残す。それ以外では、お知らせが画面を置き換える
- 文言で「結果は画面に出ている」とは言わない（F17）
- `ConnectionNotice` は、つながっている間も終わったあとも、同じ `<>{banner}{children}</>` の形を返す。こうすると順位の表が作り直されず、スポットライトの動きがもう一度始まらない

## 回答の画面

- `PlayerPage` は、`lobby` では `WaitingRoom` を、`question` からは `QuestionView`（`questionId` を key にする）を、`myResult` が届くまで出す。そのあとは `ResultView` が引き継ぐ（[結果の画面](#結果の画面)）
- `features/player/QuestionView.tsx` は段階を振り分けるだけにする。問題の番号と問題文は `QuestionFrame`、回答までの時間と締切の知らせは `AnswerFooter` が、props だけで描く
- `QuestionView.tsx` の中の `Answering` は、`accepting` の間だけある。`useCountdown` で残りを数え、押したときの計測と2回押しの防止は `useAnswerPress`（`use-answer-press.ts`）に任せる。`Answering` ごと作り直されるので、`retryQuestion`（同じ `questionId` で `question` へ戻る）で、2回押しを防ぐ ref と始まりの時刻が捨てられる
- `useAnswerPress` は、押した時刻（`performance.now()`）をイベントの中でだけ読む。`useCountdown` の `startedAt` が決まる前と締切のあとは送らない。2回押しは ref で止める。state は次の描画まで変わらないので、同じフレームの2回目を止められないため
- 始まりの時刻は、`useLayoutEffect` から頼んだ `requestAnimationFrame` の中で取り、`limitMs - remainingMs` だけ前にずらす。こうすると、問題の途中でつなぎ直した回答者も、本当の始まりから測れる
- `shared/countdown/answer-timer.ts` の `elapsedMsAt` は、ms の単位で切り捨てる。サーバーは 0.01 s で切り捨てるので、四捨五入すると 1009.6 ms が 1.01 s になってしまう
- 残り時間は、`setTimeout` で1秒の切れ目ごとに描き直す。こうすると、遅れることのある DO の alarm を待たずに、0 ちょうどでボタンを閉じられる
- 押したらすぐに回答済みとして出し、`answerAccepted` が届いたら時間を置き換える。`player.answer` は `client.send` の真偽値を返し、`false` のときはボタンを押せるままにする
- 押したボタンは消えるので、`AnsweredList`（`tabIndex={-1}`、名前は「あなたの回答」、回答していなければ「選択肢」）が作られたときに1回だけフォーカスを受け取る。それは `focusList`（`pending !== null`。この画面で押したとき）のときだけで、つなぎ直しや締切のあとには受け取らない。フォーカスした一覧は選んだ選択肢を読み上げないので、読み上げでそれを伝える
- 残り時間は、ホストの受け付け中のステージと `useCountdown`（`shared/countdown/use-countdown.ts`）を共有する
- 残り時間の棒は `TimeBar`（`shared/countdown/TimeBar.tsx`）を共有し、`variant` で太さを変える。`TimeBar` は数えず、`useCountdown` の返す `bar`（残りの割合と縮む時間）を受け取るだけにする。`bar` は `timeBarOf`（`shared/countdown/time-bar.ts`）が作る。次に描き直すときの割合へ、それまでの時間をかけて縮めるので、棒は秒の変わり目を待たずになめらかに減る
- 棒は `components/ui` の Progress（Base UI の `Progress`）にしない。Progress は必ず `role="progressbar"` と `aria-valuenow` を出すが、棒は横の残りの秒数と同じことを言うだけなので `aria-hidden` にしている。また progressbar は値が最大のときを完了（`data-complete`）とみなすので、満タンから減るカウントダウンでは、受付を始めた瞬間が完了になってしまう

## 結果の画面

- `shared/results/` の `QuestionResult`（回答者の ①）、`MyPosition`、`FastestCorrect`、`StandingsRanking`、`FinalRanking` は、protocol のメッセージを描くだけにする。順位、同点、得点、切り捨てた `elapsedMs` は、どれも DO から来る
- 画面は `StandingsRanking.tsx` と `FinalRanking.tsx` を直接読む（再 export だけの入口は置かない）。`FinalRanking` の2位から下の行は `RankRow` にし、`variant` と `emphasis`（2位と3位の札の `podium`、4位から下の行の `rest`）と `isMe` を受けて、クラスを自分で決める。呼ぶ側にクラスの文字列を渡させない。3つの部品とも、`variant` ごとのクラスは `cva` で書き、共通のクラスは `cva` の最初の引数に入れる。順位と点の字体（投影だけ `font-numeral`）は `RankRow.tsx` の `numeralVariants` を3つの部品で共有する
- 共通の部品は `variant: 'projector' | 'mobile'` を受け取り、バリアントごとのクラスの表を省かずに書く。Tailwind はクラス名を文字列のまま探すため。新しい表は `cva` で書く（`shared/status/`）。oxfmt は `cva` の引数の class を並べ替えるが、定数のオブジェクトに入れた class は並べ替えない
- `projector` は vw のトークン（`text-stage-*`、`text-timer`、`text-hero`、`p-stage`）を使う。`mobile` は決まった大きさを使い、`md:` のクラスは使わない。PC のブラウザでは、`max-w-md` の列の中でもそれが効いてしまうため
- `meId` を渡すのは回答者だけで、自分の行を目立たせる
- 秒は scoring の `formatSeconds` で書き、別の書き方の関数を作らない
- `goalOf` が「次の目標」の行を作る。4位より下では順位の数を出さない
- `ResultView` は ① と ② を重ねて出し、③ は単独で出す。`PlayerPage` は `final` で `FinalRanking` を出す

## ページタイトル

- どのルートも `head: () => pageTitle('<画面名>')` を書く（`src/lib/page-title.ts`、「<画面名> | ズバクイ」）（#109）。`__root` が `<HeadContent />` を描き、既定は `APP_NAME` にする。トップページと、ない URL はこれを出す。いちばん内側のルートのタイトルが勝つ
- タイトルには、部屋の ID、回答者の名前、問題セットの名前を入れない（S3）
- React 19 は、ルートの `<title>` を `index.html` の `<title>` より前に入れる。`index.html` のほうは、JavaScript が動く前の代わりとして残る
- ルートのテストは `document.title` を `waitFor` で確かめる。`csp.spec.ts` は、`HeadContent` がインラインのスクリプトやスタイルを足さないことを確かめる

## ホストの部屋

- `/rooms/$roomId/host`（`features/host/`）: 問題セットの一覧の `CreateRoomButton`（`features/admin/`）が `createRoom`（`src/api/rooms.ts`）を呼び、`roomId` を持ってそこへ移る
- `beforeLoad` は、`requireHost` より先に `roomIdSchema` を確かめる。そのため、形の悪い ID で `get-session` を呼ぶことはない
- loader は1つの `createHostRoom`（`host-room.ts`）を作り、回答者と同じく `onEnter`/`onLeave` が `connect`/`leave` を呼ぶ。ホストは最初のメッセージを送らない
- 参加の URL は `roomJoinUrl(roomId, location)` で、API の `joinUrl` と同じ値（同じオリジン、ADR 0006）。そのため、再読み込みしても出せる
- `JoinQrCode` は、その URL の QR を uqr の `boolean[][]`（`ecc: 'M'`、`boostEcc`、`viewBox` の中に4モジュールの余白）から描く。純粋な関数 `qrPathOf`（`qr-path.ts`）が作る1つの JSX の `<path>` にし、`innerHTML` で SVG の文字列を入れることはしない
- ホストが持ち主でない部屋と、ない部屋は 4404 で閉じ、`HostConnectionNotice` が「部屋が見つかりません」と一覧へ戻るリンクを出す
- `HostPage` は、映す部分（`lobby` では `HostLobby`、そのあとは `HostStage`）を、`HostControls` の帯（`sticky bottom-0`）の上に重ねる

## ホストの進行とフォーカス

`features/host/` の `HostControls.tsx`、`host-commands.ts`、`HostStage.tsx` と `stage/` にある。

- `forwardCommandsOf(room)` は、先へ進む操作をボタンの順に並べ、`canSend` が通すものだけを残す。最後のものが主ボタンになる
- やり直しと終了はいつも出す（やり直しは締切のあとは押せない）。送る前に、その場で確かめる（`role="alertdialog"`）。`window.confirm` は残り時間と接続を止めてしまうので使わない
- `HostPage` は `HostControls` を `phase:questionIndex` で key にする。そのため、開きかけの確認は段階が変わると残らない
- 作り直しで押したボタンが消えるので、`HostPage` は `host.send` を包む。送れて、`stageAfter`（protocol の `transition`）が段階か問題が進むと言えば、その行き先のステージを `pendingFocus` に足す。リストにするのは、② の帯では、どちらの返事も来る前に「途中経過」と「次の問題」を押せるため
- `phase`/`questionIndex` の `useLayoutEffect` が、純粋な関数 `settleFocus` を動かす。新しいステージに合う最後のものまで待っているステージを使い切り、その見出しにフォーカスを当てる（`headingRef`、`tabIndex={-1}`。映すので outline は出さない。出題・受付中・① の見出しは `StageHeading`（`stage/StageFrame.tsx`）の1か所で書き、結果の部品は `headingRef` を受け取れる）（#111）。最後に合ったものを使うのは、2つのステージが1回の描画にまとまったときと、同じ操作を2回送ったときのため
- 合うものがなければ全部捨てる。こうすると、断られた操作を通ったものと取り違えず、ほかのタブのあとの操作に合ってしまうこともない。締切を過ぎた `retryQuestion` には、`invalid_state` より先に `revealed`（`closeAnsweringIfDue` から）が届く。DO は1つの接続のメッセージを順に処理するので、本当に起きたステージはいつもエラーより先に届き、`error` を扱う必要はない
- 主ボタンにはフォーカスを当てない。Enter をもう1回押すと、① を飛ばして ② へ進んでしまう
- alarm での締切、ホストの部屋の予備のタイマー、ほかのタブの操作では、フォーカスを動かさない
- `reconnecting`/`closed` になったら印を消す。つなぎ直したあとの送り直しでは、ホスト自身の操作とほかのタブの操作を見分けられないため。今は `HostConnectionNotice` の木が変わることで、たまたま `HostScreen` が作り直されるが、それに頼らない
- 確認は帯の中に `ConfirmDialog` で出す。開いたときに「やめる」にフォーカスを当て、Esc で閉じ、作り直さずに閉じたときは開いたボタンへフォーカスを戻す（`useConfirm`。[UI の部品](#ui-の部品)）
- `HostStage` は段階を振り分けるだけにし、出題・受付中・① は `stage/` の `QuestionStage`・`AcceptingStage`・`RevealedStage` が、問題の番号の帯（`StageFrame`）の中に描く。`AcceptingStage` は `useCountdown` を呼んで残りを数えるだけで、描くのは props だけで見た目が決まる `AcceptingStageView`（ストーリーにするのはこちら）
- ① は `AnswerDistribution`（`shared/results/`）で描く（映す画面だけなので `variant` はない。棒は回答した人のうちの割合で、回答が0なら `NaN%` にせず棒を描かない。ブラウザは `NaN%` を捨てるため）。②③ と最終順位は T28 の `projector` の部品で描く
- 選択肢の色（省かずに書く）と `ChoiceNumber` は `shared/results/choice-style.tsx` にあり、受け付け中のステージと ① で共有する

## 締切の予備のタイマー

- `host-room.ts` は、`answeringStarted` のたびに、その `remainingMs` のタイマーを掛ける。時間が来て、ストアがまだその問題を受け付け中なら `closeAnswering` を送る。DO の alarm が遅れたときの予備
- ホストは受け取ってから数え始めるので、DO の締切より前に閉じることはない。2つ目のホストのタブが重ねて送ったものは `invalid_state` になる
- タイマーは `reconnecting`/`closed` で消す。切れている間に見逃したやり直しや最初からの出し直しで締切が動くうえ、古いタイマーが `hostReady` と送り直しの `answeringStarted` の間に動きうるため

## 音

- F18 の音（`shared/sound/`）は、Web Audio の発振器で作り、音のファイルは使わない
- `createSoundCues`（純粋で、接続ごとに1つ）が、メッセージを合図に変える。`questionShown`（やり直しも）→ 出題、① → 締切、その 0.7 s あと（`AudioContext` の時計で）に `reveal`（ホスト）か `correct`/`incorrect`（回答者。回答していなければ締切だけ）
- `joined`/`resumed`/`hostReady` のあとは、そのスナップショットの段階のメッセージが届くまで鳴らさない。DO が流れ全体をまとめて送り直すため。別の番号の `questionShown` が来ても、追いつきを終える
- `host-room`/`player-room` が `onMessage` の中で `sound.play(cues.next(message))` を呼ぶ。コンポーネントの effect では呼ばない
- `createSoundPlayer()` は1つだけルーターのコンテキストに置く。`main.tsx` が `unlockOnGestures(document, sound)` を足す（`click`/`keydown` を capture で、外さずに聞く。iOS で `interrupted` になった context も、次に触れたときに戻る）
- その聞き手は `[data-sound-toggle]` を飛ばす。Chrome では、クリックの中で作った context はすぐに `running` になり、トグルの `onClick` より先に React が描き直す。そのため、クリックを2回扱うと「音を有効にする」が消音になってしまっていた（jsdom では再現できない）
- 消音は `zubakui:sound` = `off`
- jsdom には `AudioContext` がないので、既定のプレイヤーは `available: false` になり、トグルを隠す。テストは `test/fake-sound.ts` の `FakeAudioContext` か `recordSounds()` を渡す

## ホストのログイン

- `src/api/auth-client.ts` が、Better Auth（`better-auth/client`）を import する唯一のファイル。Go へ作り直すときは、このファイルだけを置き換える。出すのは `fetchHostSession`、`githubSignInUrl`、`signOut`
- `githubSignInUrl` は `errorCallbackURL: '/login'` を送る。そのため、許可リストで断られると `/login?error=host_not_allowed` へ戻る。jsdom は移動できないので `disableRedirect` を使い、呼ぶ側が `location.assign` する
- クライアントは `customFetchImpl` で、呼ぶたびに全体の `fetch` を引く。そうしないと、テストで差し替えた `fetch` が使われない
- `routes/admin/route.tsx` の `beforeLoad` は `requireHost`（`src/shared/auth/require-host.ts`）。`queryClient.query(hostSessionQueryOptions)`（`src/api/host-session.ts`）を呼び、セッションがなければ `redirect({ to: '/login' })`。ホストだけのルートでは、これを使い回す
- キャッシュしたセッションは信じない（既定の `staleTime: 0` で毎回読み直す）。そのため、ほかのタブやサーバーで終わったセッションのまま `/admin` の中を移り、キャッシュした一覧を見ることはできない。`/login` の `beforeLoad` も同じことをし、ログイン済みのホストを `/admin` へ送る
- ログアウトは `queryClient.clear()` を呼ぶので、セッションも一覧も残らない
- この確かめは画面を隠すだけで、データを守るのは API の `requireHost`（S1）
- TanStack Query 5.104 は `fetchQuery`、`prefetchQuery`、`ensureQueryData` を非推奨にし、`queryClient.query(options)` に置き換えた（先読みには `.catch` を足し、ensure には `staleTime: 'static'` を使う）。`fetchQuery` と同じく、`query` は options に `retry` がなければやり直さない

## 問題セットの編集

- HTTP の呼び出しは `src/api/` に置く。`question-sets.ts` と `rooms.ts` は、`request.ts` を通して `/api/question-sets` と `/api/rooms` を呼び、応答を protocol のスキーマで読む。2xx 以外は `ApiError(status, code)`（`errors.ts`）を投げる。`code` は本文の `error`（protocol の `httpErrorSchema`）で、`safeParse` で読めたときだけ入り、csrf() の 403 のように本文が JSON でない応答では `null`。`questionSetsQueryOptions` は 4xx をやり直さないので、401 ならすぐに「ログインが切れました」を出す
- 問題セットには1問以上が要るので、「問題セットを作る」は `DRAFT_QUESTION_SET` を保存して `/admin/sets/$setId` へ移る
- 編集画面（`/admin/sets/$setId`）の loader は、`questionSetQueryOptions(setId)` を読む（訪れるたびに新しく読む）。ルートの `errorComponent` が `LoadErrorCard` で 401/404 を出す。`QuestionSetEditor`（`setId` を key にする）は、loader のデータから下書きを1回だけ作る
- 下書き（`question-set-draft.ts`）は `QuestionSetInput` ではない。`correctIndex` は `null`（まだ正解を選んでいない）でもよく、制限時間は入力欄の秒の文字列
- 編集はすべて純粋な関数 `editorReducer` を通す。選択肢が2〜4個、問題が1〜100問の外に出る編集には、同じ状態を返す
- `validateDraft` は protocol の `questionSetSchema` を動かし、問題の場所（`'questions.1.correctIndex'`）ごとに日本語のメッセージを1つ当てる。自分では決まりを持たない
- エラーは最初の「保存する」から出し、そのあとはホストが打つたびに直す
- 「保存していない」は `draft !== savedDraft`（reducer はいつも新しいオブジェクトを返す）。`useBlocker`（`shouldBlockFn` の形で、`disabled` で切り替える）と `beforeunload` が、離れる前に確かめる
- 管理画面の中を移るときの確かめは、保存の帯の中身を `ConfirmDialog` に入れ替えて出す（モーダルにしない）。開いたら「編集に戻る」にフォーカスし、戻ったら開く前にフォーカスのあった要素へ戻す。キーボードやスクリーンリーダーでリンクを押したときは、そのリンクへ戻る。macOS の Safari は、マウスで押したリンクにフォーカスを移さないので、直前まで打っていた入力欄へ戻る。押したリンクを別に覚えることはしない。フォーカスの位置に頼る人はどのブラウザでもリンクへ戻り、マウスの人には打っていた欄へ戻るのも「編集に戻る」として自然なため。ブラウザの「戻る」で止めたときは、押したリンクがそもそもない
- 問題の React の key は `newQuestionKey()` で作り、`addQuestion` のアクションで渡す。こうして reducer を純粋なままにする

## 読み上げ

- `components/a11y/`（#110）: `__root` がいつも `Announcer` を描く。`aria-live="polite"` と `assertive` の領域が1つずつで、`sr-only`、`aria-atomic`、`role` なし。そのため、`getByRole` で見える `role="status"` の箱とぶつからない
- 文と一緒に出てくる画面には、`role="status"` を付けない。`useAnnouncement(message, politeness)` で文を渡す。これは文が変わったときに `announce` を呼ぶ effect
- `announce` は領域を空にし、`ANNOUNCE_DELAY_MS`（100 ms）あとに文を入れる。React は同期の2回の set を1回の描画にまとめるので、同じ文がもう一度読まれないため
- 閉じた画面、最終順位のあとの帯、`replaced` は assertive にし、ほかは polite にする
- `useConnectionAnnouncement`（`shared/connection/use-connection-announcement.ts`。どちらの接続のお知らせも使う）は、`reconnecting` のあとだけ「つながりました」と言う
- つなぎ直しているあいだの重ね表示は、`ReconnectingOverlay`（`shared/connection/ReconnectingOverlay.tsx`）を2つのお知らせで共有し、`variant` で大きさを変える。中身を `inert` の箱に入れて薄くし、上に回る印と文の帯を重ねる。文は呼ぶ側が渡し（ホストには「進行の操作は、つながってからできます」が付く）、部品は `role="status"` も読み上げも持たない。同じ文は `useConnectionAnnouncement` が渡す
- `ConnectionNotice`（回答者）と `HostConnectionNotice`（ホスト）は1つにしない。閉じたときの文が相手ごとに違い（回答者は `replaced` と部屋の終わり方3通り、ホストは `room_not_found` と一覧へ戻るリンク）、最終ランキングのあとの扱いも違う（回答者は中身の上に帯を出し、ホストは `HostPage` が操作の帯を `HostEndedBar` に差し替える）。1つにすると、ホストかどうかの分かれ道が部品の中に増えるので、見た目が同じ重ね表示だけを部品にした
- `shared/status/` の2つの画面は、進行画面と回答者画面で共有し、`variant` で大きさを変える。つなぎの `StatusScreen`（「部屋に入っています…」「結果を集計しています」など）は自分で `useAnnouncement` を呼ぶ。見出しと本文の `MessageScreen`（満員、部屋が見つからない、接続が閉じた）は読み上げを持たない。閉じた画面の文は接続のお知らせが assertive で渡すので、部品でも言うと2回読まれる
- 回答の時間と「締切になりました」を読み上げるのは `Answering` だけ。文は `AnswerFooter.tsx` の `answerAnnouncementOf` が、見える知らせと同じ中身で作る。締切のあとの分かれ道は `AnswerFooter` を作り直すので、そこで読み上げると2回読まれる
- toast は Base UI の Viewport が持つ `role="region"`・`aria-live="polite"` の領域（名前は「通知」）が読む。`notify` は `announce` を呼ばない。呼ぶと2回読まれる（`notify.test.ts` と `QuestionSetList.test.tsx` が確かめる）。toast を `aria-hidden` にして `announce` で読ませる形はとらない。toast 本体はフォーカスできる `role="dialog"` なので、隠すとフォーカスできる要素を読み上げから隠すことになり、キーボードで止める手段もなくなる
- テストは `liveRegion(politeness)`（`test/live-region.ts`）で領域を探し、`setup.ts` がテストのたびに `clearAnnouncements()` を呼ぶ。toast の Viewport も `aria-live="polite"` を持つので、`liveRegion` と e2e は `role` のない領域（`[aria-live="polite"]:not([role])`）だけを Announcer とみなす
- Playwright の `getByText` は部分一致なので、領域にも入っている見える文は、`{ exact: true }` か `getByRole('paragraph')` で探す

## 使い方のページ

- `/guide`（`src/routes/guide.tsx` と `src/features/guide/`）は、ホストと回答者の流れを、画面の画像と一緒に順に見せる（#285）。ログインせずに開け、API を読まない。今のトップ（`/`）からは「使い方を見る」でつなぐ
- 手順は `guide-steps.ts` の配列（見出し・説明・画像の名前・alt・`device`）だけに書く。DOM にも Vite にも頼らない値だけにし、撮影のスクリプトと node のテストからも読む
- 画像は `images/<名前>.png` に置き、`GuidePage.tsx` の `import.meta.glob`（`eager`・`?url`）で URL にする。`assetsInlineLimit: 0` なので同じオリジンのハッシュ付きの URL になり、CSP の `default-src 'self'` を通る。`csp.spec.ts` が、全部の画像が `/assets/` から読めることを確かめる
- `new URL(`` `./images/${name}.png` ``, import.meta.url)` の形は使わない。Vite はこれも glob に変えるが、ソースに glob の呼び出しの文字がないので、vitest 5 の `fsModuleCache` が前の一覧を残し、画像を足しても `src` が `undefined` になる（[Storybook](#storybook) の `story-files.ts` と同じ。vitest 5.0.5 で確かめた、2026-11-12）
- `<img>` の `width`・`height` は、`device`（`pc` 1280×800・`projector` 1920×1080・`phone` 390×844）の大きさで書き、読み込む前から場所を取る。スマホの画像は幅を絞る。`test/guide-images.test.ts` が、手順ごとに PNG があること、alt が空でないこと、PNG の大きさが `device` と同じこと、どの手順も使わない PNG がないことを確かめる
- 画像は撮影のスクリプトで撮り直す。画面を変えたら、同じ変更で撮り直す（[testing.md の「使い方の画像を撮り直す」](testing.md#使い方の画像を撮り直す)）
- 事前描画（SSG）はしない。全ページを noindex にする（#284）ので検索の利点がなく、重いのは画像のほうで、JS より先に文字が出る差は小さい。ADR 0006 の SPA の前提も変えることになる（2026-11-12 に決めた）

## レイアウトの落とし穴

- 列の型を書いていない `grid` の項目は `auto` の列に入り、中の入力欄の本来の幅より縮まないので、390 px ではみ出す。縦に並べる一覧には `grid-cols-1`（`minmax(0, 1fr)`）を使う
- 同じように、`shrink-0` の flex の箱の中の `w-full` のメッセージは、箱をメッセージの1行の幅まで広げてしまう。箱には `min-w-0` を使う

## テストの道具

- `test/fake-room-server.ts`: `FakeRoomServer.createSocket` を `connectRoom` の `createSocket` に渡す。テストはサーバーを台本で動かす。`open()`、`emit(message)`（`encodeServerMessage` を通す）、`emitRaw(string)`、`closeFromServer(code)`。クライアントのメッセージは `clientMessageSchema` で読んで `received` に入れるので、形の悪いものを送るとテストが落ちる。`tsconfig.app.json` の `include` に入れている
- `createAppRouter({ createRoomSocket })` が、接続を作る関数をルーターのコンテキストに置く。ルートのテストは、そこに `FakeRoomServer.createSocket` を渡す
- `test/fake-api.ts`: `stubFakeApi({ hostName, questionSets, questionSetDetails })` が全体の `fetch` を差し替え、`/api/auth/*`（Better Auth の本物のクライアントがそこを通る）と `/api/question-sets` に答える。`questionSets` は一覧の行だけ（開くと 404）。`questionSetDetails` は `GET` で読み、`PUT` で置き換えられる。`POST` と `PUT` は本文を `questionSetSchema` で確かめ、本物の API と同じく 400 を返す。`requestsTo(method, path)` で送ったものを読み、`expireSession()` でそのあとの呼び出しを 401 にする
- `setup.ts` はテストのたびに `vi.unstubAllGlobals()` を呼ぶ。セッションを読むルート（`/admin`、`/login`）のテストは、先に `stubFakeApi` を呼ぶ
- 偽のタイマー: `vi.useFakeTimers()` は `requestAnimationFrame` と `performance.now()` も偽にする。小さな `act` の歩みで進める（`QuestionView.test.tsx` の `advance`）。次のタイマーは描き直したあとの effect で掛かるので、1回の長い `act` では最初の1回で連鎖が止まる

## 画面を実際に確かめる

画面を変えてテストが通ったら、Playwright MCP で本物のアプリでも確かめる。回答者の画面は、スマートフォンの幅（390×844）で見る。

- いちばん簡単なホストのログインは、E2E のビルドを使う方法。次を動かし（ポート 4173、`.wrangler/e2e` を消す）、`fetch('/api/e2e/login', { method: 'POST' })` が返した一覧を `page.context().addCookies(cookies)` に渡す。HMR はないので、変えたら動かし直す

  ```sh
  pnpm --filter @zubatto-quiz/web run e2e:serve
  ```

- `vite dev` では、GitHub を使わずにホストになる。手元の D1 に `user`、`session`、問題セットを入れ（`apps/api` から `wrangler d1 execute DB --local --persist-to ../web/.wrangler/state`）、cookie の `better-auth.session_token` = `encodeURIComponent(token + '.' + base64(HMAC-SHA256(BETTER_AUTH_SECRET, token)))` を `browser_run_code_unsafe`（`page.context().addCookies`）で足す。秘密の値はスクリプトの中で `apps/api/.dev.vars` から読み、表に出さない
- `POST /api/rooms` で部屋を作る（入れた問題セットの `id` は UUID にする。そうしないと 400 になる）。1つのタブで `page.evaluate` を使ってホストの WebSocket を開いてそこから進行の操作を送り、2つ目のタブで遊ぶ。終わったら、入れた行を消す
- スクリーンショットは `.playwright-mcp/`（gitignore してある）の下にしか保存できない
- QR が読めるかを確かめるには、要素のスクリーンショットを base64 で `page.evaluate` に渡し、Chromium の `BarcodeDetector` で読む
