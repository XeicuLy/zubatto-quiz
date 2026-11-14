/**
 * release job が CHANGELOG の PR と Release に書く文字列を作る（ADR 0012）。
 *
 * release job は依存パッケージを入れず、oxfmt も動かさないので、元の書式を崩さないように書き換える。
 * どれも、同じ版でもう一度呼んでも結果が変わらない（Re-run で2回足さない）。
 */

const HEADER = '# Changelog\n';

/** 文面の先頭の版の見出し（changelogen の generateMarkDown は `## v1.4.0` から始める） */
const VERSION_HEADING_RE = /^## v\d+\.\d+\.\d+\n/;

const headingOf = (notes: string): string => {
  const heading = VERSION_HEADING_RE.exec(notes)?.[0];
  if (heading === undefined) {
    throw new Error('文面が版の見出し（## vX.Y.Z）で始まらない');
  }
  return heading;
};

/** 同じ版の節（その見出しから、次の `## ` の見出しの手前まで）を取り除く。なければそのまま返す */
const withoutSection = (changelog: string, heading: string): string => {
  const lines = changelog.split('\n');
  const start = lines.indexOf(heading.trimEnd());
  if (start === -1) {
    return changelog;
  }
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return [...lines.slice(0, start), ...(next === -1 ? [] : lines.slice(next))].join('\n');
};

/**
 * CHANGELOG.md の見出しのすぐ下に、新しい版の節を置く。
 * 同じ版の節がすでにあれば、今回の文面で置き換える。中身が同じなら結果も変わらない（Re-run で2回足さない）。
 * 前の run が PR を作る前に落ちて残したブランチを、あとの run が使うときは、その run の文面で作り直す
 */
export function prependNotes(changelog: string, notes: string): string {
  if (!changelog.startsWith(HEADER)) {
    throw new Error(`CHANGELOG.md が ${HEADER.trim()} で始まらないので、足す場所が分からない`);
  }
  const rest = withoutSection(changelog, headingOf(notes)).slice(HEADER.length).replace(/^\n+/, '');
  return `${HEADER}\n${notes.trimEnd()}\n\n${rest}`;
}

/** いちばん外の `"version": "x.y.z"`。sortPackageJson の並びと2文字の字下げのまま、値だけを書き換える */
const TOP_LEVEL_VERSION_RE = /^ {2}"version": "[^"]*"/m;

export function setPackageVersion(packageJson: string, version: string): string {
  if (!TOP_LEVEL_VERSION_RE.test(packageJson)) {
    throw new Error('ルートの package.json に、いちばん外の version がない');
  }
  return packageJson.replace(TOP_LEVEL_VERSION_RE, `  "version": "${version}"`);
}

/** Release の本文。題名（vX.Y.Z）と重なる版の見出しを外す */
export function releaseBody(notes: string): string {
  return notes.slice(headingOf(notes).length).replace(/^\n+/, '');
}
