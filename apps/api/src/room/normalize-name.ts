/**
 * 名前のかぶりを確かめるための形にする（F2・ADR 0004）。participants.normalized_name に入れ、一意制約で止める。
 * 表示名は変えたくないので、この値は比べるためだけに使い、画面には出さない。
 *
 * - 全角と半角（「ＴＡＲＯ」と「TARO」、「ﾀﾛｳ」と「タロウ」）は同じ名前とみなす
 * - 英字の大文字と小文字は区別する
 * - 見えない文字を足しただけの名前は同じとみなす。protocol の playerNameSchema は制御文字（Cc）と書式の文字（Cf）を拒むが、
 *   ZWJ（U+200D）や、Cf でない見えない文字（異体字セレクタ U+FE0F、ハングルのフィラー U+3164 など）は通すため。
 *   Unicode の Default_Ignorable_Code_Point（表示しなくてよいと決まっている文字）を、まとめて除く
 * - 見えない文字だけの名前は空文字列になる。join はこれを断る
 */
export function normalizeName(name: string): string {
  // 1. NFKC で正規化する（全角の英数字が半角に、半角のカタカナが全角になる）
  // 2. 見えない文字（ZWJ を含む Default_Ignorable_Code_Point）をすべて取り除く
  // 3. 前後の空白を除く。'\u200D たろう' のように見えない文字の内側に空白があると、2 で除いて初めて外側に出てくるので、2 のあとに行う
  const normalizedName = name
    .normalize('NFKC')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .trim();
  return normalizedName;
}
