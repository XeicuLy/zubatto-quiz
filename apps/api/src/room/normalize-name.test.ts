import { describe, expect, it } from 'vitest';

import { normalizeName } from './normalize-name';

describe('名前のかぶりを確かめるための正規化（F2・ADR 0004）', () => {
  it.each([
    ['全角の英数字と半角', 'ＴＡＲＯ１', 'TARO1'],
    ['半角のカタカナと全角', 'ﾀﾛｳ', 'タロウ'],
    ['前後の空白（全角の空白も）', '\u3000たろう ', 'たろう'],
    ['前後にいろいろな幅の空白（EM SPACE）', '\u2003たろう', 'たろう'],
    ['ZWJ（U+200D）を足しただけの名前', 'たろう\u200D', 'たろう'],
    ['間に ZWJ をはさんだ名前', 'た\u200Dろう', 'たろう'],
    ['ZWJ の内側に空白がある名前', '\u200D たろう', 'たろう'],
    // 次の文字は Cc・Cf ではないので protocol の検査を通るが、見えない（Unicode の Default_Ignorable_Code_Point）
    ['異体字セレクタ（U+FE0F）を足した名前', 'たろう\uFE0F', 'たろう'],
    ['ハングルのフィラー（U+3164）を足した名前', 'たろう\u3164', 'たろう'],
    ['半角のハングルのフィラー（U+FFA0）を足した名前', '\uFFA0たろう', 'たろう'],
    ['結合書記素接続子（U+034F）をはさんだ名前', 'た\u034Fろう', 'たろう'],
  ])('%s は同じ名前とみなす', (_case, name, expected) => {
    expect(normalizeName(name)).toBe(normalizeName(expected));
  });

  it('英字の大文字と小文字は区別する', () => {
    expect(normalizeName('Taro')).not.toBe(normalizeName('taro'));
  });

  it('間の空白は残す', () => {
    expect(normalizeName('山田 太郎')).toBe('山田 太郎');
  });
});
