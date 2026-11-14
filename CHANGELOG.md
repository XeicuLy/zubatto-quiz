# Changelog

## [1.4.0](https://github.com/XeicuLy/zubatto-quiz/compare/v1.3.0...v1.4.0) (2026-11-14)


### 新機能

* 成功を toast で知らせる部品を作る ([#317](https://github.com/XeicuLy/zubatto-quiz/issues/317)) ([b54f6a8](https://github.com/XeicuLy/zubatto-quiz/commit/b54f6a8a8ce24c9c52d8e144b601221669d5488c))

## [1.3.0](https://github.com/XeicuLy/zubatto-quiz/compare/v1.2.1...v1.3.0) (2026-11-12)


### 新機能

* スクショ入りの使い方ページを足す ([#296](https://github.com/XeicuLy/zubatto-quiz/issues/296)) ([b47a169](https://github.com/XeicuLy/zubatto-quiz/commit/b47a169ec96fcf383ff45271b2f4cf2bac33fe41))
* 全ページを検索エンジンに載せない ([#297](https://github.com/XeicuLy/zubatto-quiz/issues/297)) ([eaf6c3d](https://github.com/XeicuLy/zubatto-quiz/commit/eaf6c3db224ceb47908fc11f67b64a52a95eb7f8))

## [1.2.1](https://github.com/XeicuLy/zubatto-quiz/compare/v1.2.0...v1.2.1) (2026-11-07)


### 修正

* ログイン前の経路の本文の大きさを制限する ([#266](https://github.com/XeicuLy/zubatto-quiz/issues/266)) ([9d55d7c](https://github.com/XeicuLy/zubatto-quiz/commit/9d55d7c426ca2127cd5f05343b1c7838d48678bd))
* 依存を更新し、zod と undici の脆弱性を直す ([#259](https://github.com/XeicuLy/zubatto-quiz/issues/259)) ([ab1ae00](https://github.com/XeicuLy/zubatto-quiz/commit/ab1ae0047ff50f156b8c79aedb85c7958425d10f))


### 性能

* React Compiler を本番ビルドとテストに入れる ([#249](https://github.com/XeicuLy/zubatto-quiz/issues/249)) ([9be5d37](https://github.com/XeicuLy/zubatto-quiz/commit/9be5d37f084c510ba26badf828c9af5de66bc54f))

## [1.2.0](https://github.com/XeicuLy/zubatto-quiz/compare/v1.1.0...v1.2.0) (2026-11-03)


### 新機能

* Button を問題セットの編集画面とホストの操作バーで使う ([#197](https://github.com/XeicuLy/zubatto-quiz/issues/197)) ([335440d](https://github.com/XeicuLy/zubatto-quiz/commit/335440db255cf2978c4af3885d57dc9f8f8271cb))
* Button 部品を作り、管理画面とログイン画面で使う ([#195](https://github.com/XeicuLy/zubatto-quiz/issues/195)) ([e05ac1f](https://github.com/XeicuLy/zubatto-quiz/commit/e05ac1f7f35a76209edac419eb21381fc81f465b))
* Card 部品を作り、管理画面とログイン画面で使う ([#200](https://github.com/XeicuLy/zubatto-quiz/issues/200)) ([7147140](https://github.com/XeicuLy/zubatto-quiz/commit/714714037d6bf00bb6838ac70459908ccd024f11))
* ConfirmDialog 部品を作り、3つの確認をそろえる ([#201](https://github.com/XeicuLy/zubatto-quiz/issues/201)) ([75e99f6](https://github.com/XeicuLy/zubatto-quiz/commit/75e99f6363b760beb16fafbf21b33dec7d81bb13))
* Field を問題の編集画面で使う ([#199](https://github.com/XeicuLy/zubatto-quiz/issues/199)) ([25ab4e8](https://github.com/XeicuLy/zubatto-quiz/commit/25ab4e81a73e7afc1e3795698c0da4897f4b206b))
* Field 部品を作り、参加フォームで使う ([#198](https://github.com/XeicuLy/zubatto-quiz/issues/198)) ([64ac147](https://github.com/XeicuLy/zubatto-quiz/commit/64ac147c12082e375ce7afd3ee813f57275e5fc9))

## [1.1.0](https://github.com/XeicuLy/zubatto-quiz/compare/v1.0.0...v1.1.0) (2026-10-31)


### 新機能

* 文字の大きさ・余白・フォーカスリングのトークンを作る ([#185](https://github.com/XeicuLy/zubatto-quiz/issues/185)) ([da4498f](https://github.com/XeicuLy/zubatto-quiz/commit/da4498f10ef92ff70005a69414a95bececde98a9))
* 飾り文字を投影の数字・順位とロゴだけにする ([#193](https://github.com/XeicuLy/zubatto-quiz/issues/193)) ([4662e28](https://github.com/XeicuLy/zubatto-quiz/commit/4662e288d871c1a063ab3ba6b4804fdbc6183550))


### 修正

* 選択肢の白い文字のコントラストを 4.5:1 以上にする ([#192](https://github.com/XeicuLy/zubatto-quiz/issues/192)) ([0bb7b3a](https://github.com/XeicuLy/zubatto-quiz/commit/0bb7b3a45c160435d202d2c87cb33aa236d27847))

## 1.0.0 (2026-10-28)


### 新機能

* ホストが GitHub でログインし、2〜4択の問題セットを作って保存できるようにする ([67872e3](https://github.com/XeicuLy/zubatto-quiz/commit/67872e39ddc89e9b3221e6abf0f313f8bebd7b65))
* ホストが出題・回答の受付・締切・次の問題を1つずつ進められるようにする ([67872e3](https://github.com/XeicuLy/zubatto-quiz/commit/67872e39ddc89e9b3221e6abf0f313f8bebd7b65))
* リロードや通信が切れたあとも、同じ名前と得点で部屋に戻れるようにする ([67872e3](https://github.com/XeicuLy/zubatto-quiz/commit/67872e39ddc89e9b3221e6abf0f313f8bebd7b65))
* 出題・締切・正解発表のときに効果音を鳴らす ([67872e3](https://github.com/XeicuLy/zubatto-quiz/commit/67872e39ddc89e9b3221e6abf0f313f8bebd7b65))
* 問題セットから部屋を作り、参加用の URL と QR コードを出す ([67872e3](https://github.com/XeicuLy/zubatto-quiz/commit/67872e39ddc89e9b3221e6abf0f313f8bebd7b65))
* 回答を1問1回だけ受け付け、正解の早さで点を付け、1秒以内の正解にボーナスを足す ([67872e3](https://github.com/XeicuLy/zubatto-quiz/commit/67872e39ddc89e9b3221e6abf0f313f8bebd7b65))
* 回答者が URL を開いて名前を入れるだけで参加でき、待機画面に参加者を出す ([67872e3](https://github.com/XeicuLy/zubatto-quiz/commit/67872e39ddc89e9b3221e6abf0f313f8bebd7b65))
* 回答者の手元に問題文と選択肢、自分の順位と次の目標を出す ([67872e3](https://github.com/XeicuLy/zubatto-quiz/commit/67872e39ddc89e9b3221e6abf0f313f8bebd7b65))
* 正解と回答の分布、最速の正解者、途中と最終のランキングを出す ([67872e3](https://github.com/XeicuLy/zubatto-quiz/commit/67872e39ddc89e9b3221e6abf0f313f8bebd7b65))
* 画面ごとにページタイトルを付け、接続や回答の状態を読み上げで伝える ([67872e3](https://github.com/XeicuLy/zubatto-quiz/commit/67872e39ddc89e9b3221e6abf0f313f8bebd7b65))
