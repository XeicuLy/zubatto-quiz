import { describe, expect, it } from 'vitest';

import { read, repoRoot } from './documents';

const threatModel = read(new URL('docs/security/threat-model.md', repoRoot));

/** `## 見出し` から次の `## ` の手前まで。無ければ空 */
function sectionOf(heading: string) {
  const start = threatModel.indexOf(`\n## ${heading}\n`);
  if (start === -1) return '';
  const rest = threatModel.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

const isSeparator = (line: string) => /^\|[\s|:-]+\|$/.test(line);

/** 表の行を、見出しの行とデータの行に分ける。見出しの行は、すぐ下に区切りの行がある行 */
function tablesIn(section: string) {
  const lines = section.split('\n').filter((line) => line.startsWith('|'));
  const headers = lines.filter((_, index) => isSeparator(lines[index + 1] ?? ''));
  const rows = lines.filter((line) => !isSeparator(line) && !headers.includes(line));
  return { headers, rows };
}

const cellsOf = (row: string) =>
  row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());

/** セルの中の、リポジトリの中を指す相対リンクの先。外の URL は除く */
const relativeLinksIn = (cell: string) =>
  [...cell.matchAll(/\]\(([^)\s]+)\)/g)].map(([, target = '']) => target).filter((target) => !/^[a-z]+:/.test(target));

const isTestFile = (target: string) => /\.(test|spec)\.tsx?$/.test(target.split('#')[0] ?? '');

describe('脅威モデル（docs/security/threat-model.md）', () => {
  it.each(['守るもの', '攻撃者', '経路', '確かめた守り', 'これから入れる守り', '受け入れたリスク'])(
    '「%s」の節がある',
    (heading) => {
      expect(sectionOf(heading)).not.toBe('');
    },
  );

  describe('確かめた守りの表', () => {
    const { headers, rows } = tablesIn(sectionOf('確かめた守り'));

    // 見出しの言葉や表の形を変えて行を読めなくなったとき、下の確かめが0件で黙って通らないようにする
    it('表があり、行がある', () => {
      expect(headers.length).toBeGreaterThan(0);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('どの表も、列は「守り｜どこで｜確かめるテスト」の順にする', () => {
      for (const header of headers) expect(cellsOf(header)).toEqual(['守り', 'どこで', '確かめるテスト']);
    });

    const cells = rows.map((row) => {
      const [defense = '', where = '', tests = ''] = cellsOf(row);
      return { defense, where, tests };
    });

    // リンクの先が実在するかは links.test.ts が確かめる。ここでは、どの行もリンクを持つことを確かめる
    it.each(cells)('「$defense」の「どこで」が、守っているファイルへの相対リンクを持つ', ({ where }) => {
      expect(relativeLinksIn(where)).not.toEqual([]);
    });

    it.each(cells)('「$defense」の「確かめるテスト」が、テストのファイルへの相対リンクを持つ', ({ tests }) => {
      expect(relativeLinksIn(tests).some(isTestFile)).toBe(true);
    });
  });

  // 入ったときに「確かめた守り」へ移す行なので、どの Issue が入れるかを書いておく
  it('これから入れる守りは、どの行も Issue の番号を持つ', () => {
    const { rows } = tablesIn(sectionOf('これから入れる守り'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toMatch(/#\d+/);
  });
});
