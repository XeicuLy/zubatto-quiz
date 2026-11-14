import { describe, expect, it } from 'vitest';

import { prependNotes, releaseBody, setPackageVersion } from '../src/files.ts';

const NOTES = `## v1.4.0

[compare changes](https://github.com/XeicuLy/zubatto-quiz/compare/v1.3.0...v1.4.0)

### 🚀 Enhancements

- 何かを足す ([#1](https://github.com/XeicuLy/zubatto-quiz/pull/1))
`;

const CHANGELOG = `# Changelog

## [1.3.0](https://github.com/XeicuLy/zubatto-quiz/compare/v1.2.1...v1.3.0) (2026-11-12)


### 新機能

* 前の節
`;

describe('prependNotes（CHANGELOG.md の先頭に新しい版の節を足す）', () => {
  it('見出し（# Changelog）のすぐ下に、新しい版の節を足し、前の節はそのまま残す', () => {
    expect(prependNotes(CHANGELOG, NOTES)).toBe(`# Changelog

${NOTES}
## [1.3.0](https://github.com/XeicuLy/zubatto-quiz/compare/v1.2.1...v1.3.0) (2026-11-12)


### 新機能

* 前の節
`);
  });

  it('同じ版の節がすでにあれば、何も変えない（release を Re-run しても2回足さない）', () => {
    const once = prependNotes(CHANGELOG, NOTES);
    expect(prependNotes(once, NOTES)).toBe(once);
  });

  it('文面の末尾の空行の数によらず、節のあいだは空行1つにする', () => {
    expect(prependNotes(CHANGELOG, `${NOTES}\n\n`)).toBe(prependNotes(CHANGELOG, NOTES.trimEnd()));
  });

  it('見出しで始まらない CHANGELOG には、足す場所が分からないので例外にする', () => {
    expect(() => prependNotes('## v1.3.0\n', NOTES)).toThrow('# Changelog');
  });

  it('文面が版の見出し（## vX.Y.Z）で始まらなければ、例外にする', () => {
    expect(() => prependNotes(CHANGELOG, '### 🚀 Enhancements\n')).toThrow('## v');
  });
});

describe('setPackageVersion（ルートの package.json の version）', () => {
  const pkg = `{
  "name": "zubatto-quiz",
  "version": "1.3.0",
  "private": true,
  "devDependencies": {
    "some-tool": {
      "version": "9.9.9"
    }
  }
}
`;

  it('version の値だけを書き換え、並びと書式はそのまま残す', () => {
    expect(setPackageVersion(pkg, '1.4.0')).toBe(pkg.replace('"version": "1.3.0"', '"version": "1.4.0"'));
  });

  it('入れ子の version は書き換えない', () => {
    expect(setPackageVersion(pkg, '1.4.0')).toContain('"version": "9.9.9"');
  });

  it('同じ版なら何も変えない', () => {
    expect(setPackageVersion(pkg, '1.3.0')).toBe(pkg);
  });

  it('いちばん外の version がなければ、例外にする', () => {
    expect(() => setPackageVersion('{\n  "name": "x"\n}\n', '1.4.0')).toThrow('version');
  });
});

describe('releaseBody（GitHub Release の本文）', () => {
  it('Release の題名と重なる版の見出しを外す', () => {
    expect(releaseBody(NOTES)).toBe(`[compare changes](https://github.com/XeicuLy/zubatto-quiz/compare/v1.3.0...v1.4.0)

### 🚀 Enhancements

- 何かを足す ([#1](https://github.com/XeicuLy/zubatto-quiz/pull/1))
`);
  });
});
