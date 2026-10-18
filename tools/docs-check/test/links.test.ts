import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { documents, read, repoRoot } from './documents';

/**
 * GitHub が見出しに付ける ID。小文字にし、文字・数字・空白・`-`・`_` 以外を消し、空白を `-` にする。
 * 同じ見出しが2つあるときの `-1` は、使っていないので扱わない
 */
const slugOf = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

/** コードブロックの外の見出しの ID */
function anchorsOf(url: URL): string[] {
  const outsideCode = read(url).replace(/^```[\s\S]*?^```/gm, '');
  return [...outsideCode.matchAll(/^#{1,6} (.+)$/gm)].map(([, heading = '']) => slugOf(heading));
}

/** Markdown の [文字](先) のうち、リポジトリの中を指すもの。外の URL は除く */
function linksOf(document: string) {
  return [...read(new URL(document, repoRoot)).matchAll(/\]\(([^)\s]+)\)/g)]
    .map(([, target = '']) => target)
    .filter((target) => !/^[a-z]+:/.test(target))
    .map((target) => {
      const [path = '', anchor] = target.split('#');
      return { document, target, url: new URL(path, new URL(document, repoRoot)), anchor };
    });
}

const links = documents.flatMap(linksOf);

describe('README と手順書のリンク', () => {
  it('README から手順書へのリンクがある', () => {
    expect(links.some(({ document, target }) => document === 'README.md' && target.startsWith('docs/runbooks/'))).toBe(
      true,
    );
  });

  it.each(links)('$document の $target の先が、リポジトリの中にある', ({ url }) => {
    // 外を指すリンクは、手元にたまたまファイルがあっても GitHub の上では切れる。先に確かめ、本当の理由で落とす
    expect(url.href.startsWith(repoRoot.href)).toBe(true);
    expect(existsSync(url)).toBe(true);
  });

  it.each(links.filter(({ anchor }) => anchor !== undefined))(
    '$document の $target の見出しがある',
    ({ url, anchor }) => {
      expect(anchorsOf(url)).toContain(decodeURIComponent(anchor ?? ''));
    },
  );
});
