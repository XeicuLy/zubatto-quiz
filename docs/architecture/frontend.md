# 画面の仕組み

`apps/web`（SPA と、`/api/*` を転送する画面の Worker）が、どう動き、どこに何があるかをまとめる。決めた理由の大もとは [ADR 0006](../adr/0006-spa-and-api-worker-layout.md) と [ADR 0007](../adr/0007-ui-components-approach.md) にあり、ここには ADR に書いていない約束と、コードのどこで守っているかを書く。

コードを書くときに守る約束は、[CLAUDE.md](../../CLAUDE.md) に1行ずつ残している。この文書はその説明で、見出しを変えるときは CLAUDE.md のリンクも直す（docs-check が確かめる）。要件の ID（`S1` など）は[要件定義書](../requirements/zubatto-quiz.md)で引く。部屋の DO やメッセージの側の話は [backend.md](backend.md) にある。

## 全体の形

- 素の Vite の SPA（`index.html` + `src/main.tsx`）で、TanStack Router のファイルルートを使い、TanStack Query をルーターのコンテキストに置く。Tailwind CSS v4 のトークンは `src/styles.css` の `@theme` に書き、`tailwind.config.js` は使わない
- フォントは `@fontsource` から読む。こうすると CSP は `'self'` のままで済む
- `@/*` は `apps/web/src/*` を指す。`tsconfig.json`（shadcn の CLI はこのファイルだけを読み、references は読まない）と `tsconfig.app.json` の `paths`、`vite.config.ts` と `vitest.config.ts` の両方の `resolve.alias` に書く。今ある `../` の import を書き換えるのは #180
- `src/routeTree.gen.ts` は、ルーターのプラグインが `vite dev`/`build` と vitest のときに作る。コミットする。oxfmt と oxlint は飛ばす。`src/routes/` の中のテストのファイルは `routeFileIgnorePattern` で外す。これは `vite.config.ts` と `vitest.config.ts` の両方に書く
- `vitest.config.ts` は `vite.config.ts` を読まない。Cloudflare のプラグインが Workers を起こしてしまうため
- DOM と Workers の型がぶつかるので、tsconfig を3つに分ける。`tsconfig.app.json`（DOM、`src/`）、`tsconfig.worker.json`（`src/server.ts` とそのテスト、Workers の型）、`tsconfig.node.json`（設定ファイルと `test/*.test.ts`）。ファイルを読むテストは `// @vitest-environment node` で node で動かし、`test/` に置く
- `vite dev` は `auxiliaryWorkers` で2つの Worker を両方動かす。`apps/web/wrangler.jsonc` か `src/server.ts` を変えたら、次で型を作り直す

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

## 色の役割

- 色の役割は shadcn の名前（`background`/`foreground`、`card`、`primary`/`primary-foreground`、`muted`、`destructive`/`destructive-foreground`、`border`、`input`、`ring`…）にそろえる（#124、ADR 0007）。どれも `@theme inline` の項目で、中身は `:root`（明るい管理画面）と `.stage`（暗いステージ）に置いた素の変数。そのため `bg-primary` は `var(--primary)` をそのまま読み、`.stage` の中では値が入れ替わる。`@custom-variant dark` も `.stage` を指す。今は `.stage` を付けた画面はまだない
- アプリだけの色は `<name>` と `<name>-foreground` の組にする（`choice-1`…`4`、`spotlight`、`correct`、`alert`）。`alert` はステージのお知らせの帯で、エラーと危ない操作には `destructive` を使う
- 前の名前（`stage*`、`backstage*`、`on-*`、`alert-strong`）は、#134 まで値を残す。`styles.test.ts` が、面ごとに各役割をそれが表す前の名前と比べるので、色を変えても（#126）対応が黙って崩れることはない
- 文字と背景の組は、投影でもスマホでも 4.5:1 以上にする（ADR 0007）。`test/contrast.test.ts` が、組の表（`<name>-foreground` と `<name>`、面ごとの `foreground` と `background` など）のコントラストを、コンパイルした CSS の値から計算する。計算は oklch → OKLab → 線形 sRGB → 相対輝度で、依存は増やさない。sRGB の外の色は、sRGB の画面では切り詰められ、P3 の画面ではそのまま出て明るさが変わるので、2通りに測って低いほうを見る。新しい組を作ったら表に足す
- 選択肢の白い文字が 4.5:1 に届くよう、`choice-1`〜`3` は文字ではなく背景を暗くした（#126）。番号がいつも出ているので、4色の見分けは番号でもできる。どれも sRGB の中に収まる値にしてある

## 文字と余白とフォーカス

値は、デジタル庁デザインシステムを 2026-10-30 に確かめたもの（#125、ADR 0007）。

- 字体は2つ。飾り文字の Dela Gothic One は、投影の数字・順位の `font-numeral` とロゴの `font-logo` だけに使う。ほかは本文の M PLUS 1 で、見出しは `font-bold` で太くする。入力欄は親の字体を受け継ぐので、ラベルに飾り文字を付けると入力と字体がずれる。`font-numeral` は数字だけを包み、「第」「問」「秒」「位」「点」「人」などの単位と記号は外の `font-bold`（M PLUS 1）で出す。results の部品は、variant の対応表で投影のときだけ `font-numeral` を渡す。`test/font-roles.test.ts` が、使ってよいファイルを確かめる
- Dela Gothic One は太さ 400 しかなく、`font-bold` の中ではブラウザが字を太らせて潰す。`@layer base` の `html { font-synthesis-weight: none }` がこれを止める。M PLUS 1 は可変フォントで本物の太さを持つので、影響しない
- 文字の大きさは役割で選ぶ。`text-title`/`heading`/`body`/`note`/`label`（どれも大きさ・行の高さ・字間をまとめて決める）を使い、`text-lg` は使わない。vw の `text-stage-*`/`p-stage` のトークンは、プロジェクターに映す画面だけで使う
- 余白は、ものどうしの関係で名前を付ける。`related`/`item`/`cluster`/`section`（8/16/24/64 px）。`--spacing-md` のような大きさの名前は足さない。足すと `max-w-md` がそれを読んでしまう
- `@layer base` の `:focus-visible` が、`--ring` の 4 px の outline を 2 px 離して描き、その間を `--color-focus`（Yellow-300）の `ring-2` で埋める。この ring は Tailwind の影の変数を通るので、`shadow-panel` と重ねられる
- スクリプトだけでフォーカスを当てる要素（ホストの操作のあとの、映している見出し）には `focus-target` を使う。`outline-none` では黄色の ring が残るため
- 要素ごとの `focus-visible:outline-*` のクラスは、これを上書きしてしまう。`components/ui` の部品は持たないので、部品に置き換えると消える。まだ部品になっていないところ（ホストの操作バー、入力欄など）は、#129・#130 などで置き換えるまで残る

## shadcn と cn

- `shadcn init`（CLI 4.22.1、`base-nova`）は1回だけ動かした。見た目を変えるものは取り除いた。Geist と `--font-sans` の上書き、`--radius-*`、`tw-animate-css`、`*` への `@layer base` のルール（`border-border outline-ring/50` はブラウザの既定のフォーカスリングの色を変えてしまう）、`body` と `html` のルール、チャートとサイドバーの色。`lucide-react` も外した。`@base-ui/react` と `class-variance-authority` は、`components/ui` の部品が使う（[UI の部品](#ui-の部品)）。Geist、radius の上書き、役割の色を全体に当てるルールが戻ると、テストが落ちる
- `shadcn` を devDependency に入れているのは、`@import 'shadcn/tailwind.css'`（`data-open:` のようなバリアント）のためだけ。その中の8つの `@property` のルールと、`.shimmer` の動きを減らすルールはいつも出力に入り、残りは使ったときだけ入る
- `cn` は `src/lib/tailwind.ts` にある（`cn/config` の `createCn`。`components.json` の `utils` の別名もここを指す）。色とフォントでない `@theme` の名前は、すべて `createCn` に教える。教えないと、`cn('text-stage-label', 'text-on-stage')` が文字の大きさを落としてしまう。`test/cn-theme.test.ts` が styles.css から名前を読むので、新しい `@theme` の名前は、`tailwind.ts` に並べるまでテストが落ちる
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
- 角はすべて `rounded-full`。早押しパネルの厚み（`shadow-panel` と、押すと沈む `active:translate-y-1.5`）は、cva の `compoundVariants` で `default` × `lg` だけに付ける。目立たせるのは、その画面の大きな主の操作1つにする
- `outline` の枠は `border-foreground`。文字でない枠も、隣の色に 3:1 以上にする（ADR 0007 のデジタル庁デザインシステムの値）。`border` の色では、どちらの面でも届かない
- `type` は Base UI が既定で `"button"` を付ける。フォームを送るボタンだけ `type="submit"` を渡す
- アイコンは文字と並べて子に置く。`svg` は文字の 1.25 倍の大きさになり（`size-*` を付けたものはそのまま）、文字との間は `gap-related` でとる。アイコンは `aria-hidden` にし、ボタンの名前は文字だけにする
- ブランドのロゴは `src/components/icons/` に、ライセンスのはっきりした配布元の SVG の path をそのまま JSX で置く。`lucide-react` は 1.0 でブランドのロゴを消した（2026-10-31 に確かめた）。GitHub のロゴ（`github-mark.tsx`）は Simple Icons の `github.svg`（CC0-1.0）で、著作権表示が要らない。MIT のもの（Primer Octicons など）を写すときは、著作権表示と許諾文もファイルに入れる。`fill="currentColor"` で文字の色に合わせる。simpleicons.org などから実行時に読み込むと CSP で止まるので、path を写す。インラインの SVG は `<style>` でも `style` 属性でもないので、CSP は変えなくてよい
- `<Link>` をボタンの見た目にするときは、`className={buttonVariants({ ... })}` で class だけを渡す。`Button` の `render` で `<a>` を描かせると `role="button"` が付き、リンクとして読まれなくなる

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

- `features/results/room-end.ts` の純粋な関数 `roomEndOf(state)` が、`room_ended` で閉じたあとに残ったストアを読み、次の3つに分ける。`after_final`（段階が `final` で `finalRanking` がある）、`midway`、`not_entered`（`room === null`。再読み込みしたか、遅れて来て DO に `room_ended` で断られたので、どこで終わったかが分からない）
- `after_final` では、`ConnectionNotice`（最終順位の上の帯）と `HostPage`（`HostControls` のかわりに `HostEndedBar`）のどちらも最終順位を残す。それ以外では、お知らせが画面を置き換える
- 文言で「結果は画面に出ている」とは言わない（F17）
- `ConnectionNotice` は、つながっている間も終わったあとも、同じ `<>{banner}{children}</>` の形を返す。こうすると順位の表が作り直されず、スポットライトの動きがもう一度始まらない

## 回答の画面

- `PlayerPage` は、`lobby` では `WaitingRoom` を、`question` からは `QuestionView`（`questionId` を key にする）を、`myResult` が届くまで出す。そのあとは `ResultView` が引き継ぐ（[結果の画面](#結果の画面)）
- `features/player/QuestionView.tsx` の中の `Answering` は、`accepting` の間だけある。そのため、`retryQuestion`（同じ `questionId` で `question` へ戻る）で、2回押しを防ぐ ref と始まりの時刻が捨てられる
- 始まりの時刻は、`useLayoutEffect` から頼んだ `requestAnimationFrame` の中で取り、`limitMs - remainingMs` だけ前にずらす。こうすると、問題の途中でつなぎ直した回答者も、本当の始まりから測れる
- `answer-timer.ts` の `elapsedMsAt` は、ms の単位で切り捨てる。サーバーは 0.01 s で切り捨てるので、四捨五入すると 1009.6 ms が 1.01 s になってしまう
- 残り時間は、`setTimeout` で1秒の切れ目ごとに描き直す。こうすると、遅れることのある DO の alarm を待たずに、0 ちょうどでボタンを閉じられる
- 押したらすぐに回答済みとして出し、`answerAccepted` が届いたら時間を置き換える。`player.answer` は `client.send` の真偽値を返し、`false` のときはボタンを押せるままにする
- 押したボタンは消えるので、`AnsweredList`（`tabIndex={-1}`、名前は「あなたの回答」、回答していなければ「選択肢」）が作られたときに1回だけフォーカスを受け取る。それは `focusList`（`pending !== null`。この画面で押したとき）のときだけで、つなぎ直しや締切のあとには受け取らない。フォーカスした一覧は選んだ選択肢を読み上げないので、読み上げでそれを伝える
- 残り時間は、ホストの受け付け中のステージと `useCountdown`（`features/player/use-countdown.ts`）を共有する

## 結果の画面

- `features/results/` の `QuestionResult`（回答者の ①）、`MyPosition`、`FastestCorrect`、`Ranking.tsx`（`StandingsRanking`、`FinalRanking`）は、protocol のメッセージを描くだけにする。順位、同点、得点、切り捨てた `elapsedMs` は、どれも DO から来る
- 共通の部品は `variant: 'projector' | 'mobile'` を受け取り、バリアントごとのクラスの表を省かずに書く。Tailwind はクラス名を文字列のまま探すため
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

- `/rooms/$roomId/host`（`features/host/`）: 問題セットの一覧の `CreateRoomButton` が `createRoom`（`features/admin/api.ts`）を呼び、`roomId` を持ってそこへ移る
- `beforeLoad` は、`requireHost` より先に `roomIdSchema` を確かめる。そのため、形の悪い ID で `get-session` を呼ぶことはない
- loader は1つの `createHostRoom`（`host-room.ts`）を作り、回答者と同じく `onEnter`/`onLeave` が `connect`/`leave` を呼ぶ。ホストは最初のメッセージを送らない
- 参加の URL は `roomJoinUrl(roomId, location)` で、API の `joinUrl` と同じ値（同じオリジン、ADR 0006）。そのため、再読み込みしても出せる
- `JoinQrCode` は、その URL の QR を uqr の `boolean[][]`（`ecc: 'M'`、`boostEcc`、`viewBox` の中に4モジュールの余白）から描く。純粋な関数 `qrPathOf`（`qr-path.ts`）が作る1つの JSX の `<path>` にし、`innerHTML` で SVG の文字列を入れることはしない
- ホストが持ち主でない部屋と、ない部屋は 4404 で閉じ、`HostConnectionNotice` が「部屋が見つかりません」と一覧へ戻るリンクを出す
- `HostPage` は、映す部分（`lobby` では `HostLobby`、そのあとは `HostStage`）を、`HostControls` の帯（`sticky bottom-0`）の上に重ねる

## ホストの進行とフォーカス

`HostControls.tsx`、`host-commands.ts`、`HostStage.tsx` にある。

- `forwardCommandsOf(room)` は、先へ進む操作をボタンの順に並べ、`canSend` が通すものだけを残す。最後のものが主ボタンになる
- やり直しと終了はいつも出す（やり直しは締切のあとは押せない）。送る前に、その場で確かめる（`role="alertdialog"`）。`window.confirm` は残り時間と接続を止めてしまうので使わない
- `HostPage` は `HostControls` を `phase:questionIndex` で key にする。そのため、開きかけの確認は段階が変わると残らない
- 作り直しで押したボタンが消えるので、`HostPage` は `host.send` を包む。送れて、`stageAfter`（protocol の `transition`）が段階か問題が進むと言えば、その行き先のステージを `pendingFocus` に足す。リストにするのは、② の帯では、どちらの返事も来る前に「途中経過」と「次の問題」を押せるため
- `phase`/`questionIndex` の `useLayoutEffect` が、純粋な関数 `settleFocus` を動かす。新しいステージに合う最後のものまで待っているステージを使い切り、その見出しにフォーカスを当てる（`headingRef`、`tabIndex={-1}`。映すので outline は出さない。結果の部品は `headingRef` を受け取れる）（#111）。最後に合ったものを使うのは、2つのステージが1回の描画にまとまったときと、同じ操作を2回送ったときのため
- 合うものがなければ全部捨てる。こうすると、断られた操作を通ったものと取り違えず、ほかのタブのあとの操作に合ってしまうこともない。締切を過ぎた `retryQuestion` には、`invalid_state` より先に `revealed`（`closeAnsweringIfDue` から）が届く。DO は1つの接続のメッセージを順に処理するので、本当に起きたステージはいつもエラーより先に届き、`error` を扱う必要はない
- 主ボタンにはフォーカスを当てない。Enter をもう1回押すと、① を飛ばして ② へ進んでしまう
- alarm での締切、ホストの部屋の予備のタイマー、ほかのタブの操作では、フォーカスを動かさない
- `reconnecting`/`closed` になったら印を消す。つなぎ直したあとの送り直しでは、ホスト自身の操作とほかのタブの操作を見分けられないため。今は `HostConnectionNotice` の木が変わることで、たまたま `HostScreen` が作り直されるが、それに頼らない
- 確認の帯は、開いたときに「やめる」にフォーカスを当て（ref を使い、`autoFocus` は使わない）、Esc で閉じ（`alertdialog` の `onKeyDown`）、作り直さずに閉じたときは開いたボタンへフォーカスを戻す
- `HostStage` は、① を `AnswerDistribution` で描く（映す画面だけなので `variant` はない。棒は回答した人のうちの割合で、回答が0なら `NaN%` にせず棒を描かない。ブラウザは `NaN%` を捨てるため）。②③ と最終順位は T28 の `projector` の部品で描く
- 選択肢の色（省かずに書く）と `ChoiceNumber` は `features/results/choice-style.tsx` にあり、受け付け中のステージと ① で共有する

## 締切の予備のタイマー

- `host-room.ts` は、`answeringStarted` のたびに、その `remainingMs` のタイマーを掛ける。時間が来て、ストアがまだその問題を受け付け中なら `closeAnswering` を送る。DO の alarm が遅れたときの予備
- ホストは受け取ってから数え始めるので、DO の締切より前に閉じることはない。2つ目のホストのタブが重ねて送ったものは `invalid_state` になる
- タイマーは `reconnecting`/`closed` で消す。切れている間に見逃したやり直しや最初からの出し直しで締切が動くうえ、古いタイマーが `hostReady` と送り直しの `answeringStarted` の間に動きうるため

## 音

- F18 の音（`features/sound/`）は、Web Audio の発振器で作り、音のファイルは使わない
- `createSoundCues`（純粋で、接続ごとに1つ）が、メッセージを合図に変える。`questionShown`（やり直しも）→ 出題、① → 締切、その 0.7 s あと（`AudioContext` の時計で）に `reveal`（ホスト）か `correct`/`incorrect`（回答者。回答していなければ締切だけ）
- `joined`/`resumed`/`hostReady` のあとは、そのスナップショットの段階のメッセージが届くまで鳴らさない。DO が流れ全体をまとめて送り直すため。別の番号の `questionShown` が来ても、追いつきを終える
- `host-room`/`player-room` が `onMessage` の中で `sound.play(cues.next(message))` を呼ぶ。コンポーネントの effect では呼ばない
- `createSoundPlayer()` は1つだけルーターのコンテキストに置く。`main.tsx` が `unlockOnGestures(document, sound)` を足す（`click`/`keydown` を capture で、外さずに聞く。iOS で `interrupted` になった context も、次に触れたときに戻る）
- その聞き手は `[data-sound-toggle]` を飛ばす。Chrome では、クリックの中で作った context はすぐに `running` になり、トグルの `onClick` より先に React が描き直す。そのため、クリックを2回扱うと「音を有効にする」が消音になってしまっていた（jsdom では再現できない）
- 消音は `zubakui:sound` = `off`
- jsdom には `AudioContext` がないので、既定のプレイヤーは `available: false` になり、トグルを隠す。テストは `test/fake-sound.ts` の `FakeAudioContext` か `recordSounds()` を渡す

## ホストのログイン

- `src/lib/auth-client.ts` が、Better Auth（`better-auth/client`）を import する唯一のファイル。Go へ作り直すときは、このファイルだけを置き換える。出すのは `fetchHostSession`、`githubSignInUrl`、`signOut`
- `githubSignInUrl` は `errorCallbackURL: '/login'` を送る。そのため、許可リストで断られると `/login?error=host_not_allowed` へ戻る。jsdom は移動できないので `disableRedirect` を使い、呼ぶ側が `location.assign` する
- クライアントは `customFetchImpl` で、呼ぶたびに全体の `fetch` を引く。そうしないと、テストで差し替えた `fetch` が使われない
- `/admin/route.tsx` の `beforeLoad` は `requireHost`（`features/admin/host-session.ts`）。`queryClient.query(hostSessionQueryOptions)` を呼び、セッションがなければ `redirect({ to: '/login' })`。ホストだけのルートでは、これを使い回す
- キャッシュしたセッションは信じない（既定の `staleTime: 0` で毎回読み直す）。そのため、ほかのタブやサーバーで終わったセッションのまま `/admin` の中を移り、キャッシュした一覧を見ることはできない。`/login` の `beforeLoad` も同じことをし、ログイン済みのホストを `/admin` へ送る
- ログアウトは `queryClient.clear()` を呼ぶので、セッションも一覧も残らない
- この確かめは画面を隠すだけで、データを守るのは API の `requireHost`（S1）
- TanStack Query 5.104 は `fetchQuery`、`prefetchQuery`、`ensureQueryData` を非推奨にし、`queryClient.query(options)` に置き換えた（先読みには `.catch` を足し、ensure には `staleTime: 'static'` を使う）。`fetchQuery` と同じく、`query` は options に `retry` がなければやり直さない

## 問題セットの編集

- `features/admin/api.ts` は、protocol のスキーマで `/api/question-sets` を呼び、`ApiError(status)` を投げる。`questionSetsQueryOptions` は 4xx をやり直さないので、401 ならすぐに「ログインが切れました」を出す
- 問題セットには1問以上が要るので、「問題セットを作る」は `DRAFT_QUESTION_SET` を保存して `/admin/sets/$setId` へ移る
- 編集画面（`/admin/sets/$setId`）の loader は、`questionSetQueryOptions(setId)` を読む（訪れるたびに新しく読む）。ルートの `errorComponent` が 401/404 を出す。`QuestionSetEditor`（`setId` を key にする）は、loader のデータから下書きを1回だけ作る
- 下書き（`question-set-draft.ts`）は `QuestionSetInput` ではない。`correctIndex` は `null`（まだ正解を選んでいない）でもよく、制限時間は入力欄の秒の文字列
- 編集はすべて純粋な関数 `editorReducer` を通す。選択肢が2〜4個、問題が1〜100問の外に出る編集には、同じ状態を返す
- `validateDraft` は protocol の `questionSetSchema` を動かし、問題の場所（`'questions.1.correctIndex'`）ごとに日本語のメッセージを1つ当てる。自分では決まりを持たない
- エラーは最初の「保存する」から出し、そのあとはホストが打つたびに直す
- 「保存していない」は `draft !== savedDraft`（reducer はいつも新しいオブジェクトを返す）。`useBlocker`（`shouldBlockFn` の形で、`disabled` で切り替える）と `beforeunload` が、離れる前に確かめる
- 問題の React の key は `newQuestionKey()` で作り、`addQuestion` のアクションで渡す。こうして reducer を純粋なままにする

## 読み上げ

- `components/a11y/`（#110）: `__root` がいつも `Announcer` を描く。`aria-live="polite"` と `assertive` の領域が1つずつで、`sr-only`、`aria-atomic`、`role` なし。そのため、`getByRole` で見える `role="status"` の箱とぶつからない
- 文と一緒に出てくる画面には、`role="status"` を付けない。`useAnnouncement(message, politeness)` で文を渡す。これは文が変わったときに `announce` を呼ぶ effect
- `announce` は領域を空にし、`ANNOUNCE_DELAY_MS`（100 ms）あとに文を入れる。React は同期の2回の set を1回の描画にまとめるので、同じ文がもう一度読まれないため
- 閉じた画面、最終順位のあとの帯、`replaced` は assertive にし、ほかは polite にする
- `useConnectionAnnouncement`（どちらの接続のお知らせも使う）は、`reconnecting` のあとだけ「つながりました」と言う
- 回答の時間と「締切になりました」を読み上げるのは `Answering` だけ。締切のあとの分かれ道は `AnswerFooter` を作り直すので、そこで読み上げると2回読まれる
- テストは `liveRegion(politeness)`（`test/live-region.ts`）で領域を探し、`setup.ts` がテストのたびに `clearAnnouncements()` を呼ぶ
- Playwright の `getByText` は部分一致なので、領域にも入っている見える文は、`{ exact: true }` か `getByRole('paragraph')` で探す

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
