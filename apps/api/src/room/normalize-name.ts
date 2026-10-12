/**
 * 名前のかぶりを確かめるための形にする（F2・ADR 0004）。participants.normalized_name に入れ、一意制約で止める。
 * 表示名は変えたくないので、この値は比べるためだけに使い、画面には出さない。
 *
 * - 全角と半角（「ＴＡＲＯ」と「TARO」、「ﾀﾛｳ」と「タロウ」）は同じ名前とみなす
 * - 英字の大文字と小文字は区別する
 * - ZWJ（U+200D）は protocol の playerNameSchema が通すが、見えないので、足しただけの名前を同じとみなす
 */
export function normalizeName(name: string): string {
  // 1. NFKC で正規化する（全角の英数字が半角に、半角のカタカナが全角になる）
  // 2. ZWJ（'\u200D'）をすべて取り除く
  // 3. 前後の空白を除く。'\u200D たろう' のように ZWJ の内側に空白があると、2 で ZWJ を除いて初めて外側に出てくるので、2 のあとに行う
  const normalizedName = name.normalize('NFKC').replaceAll('\u200D', '').trim();
  return normalizedName;
}
