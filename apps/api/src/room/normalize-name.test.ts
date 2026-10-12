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
