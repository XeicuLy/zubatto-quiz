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

/** 表の区切りの行（`| --- | :-: |`）。外側の | は省いてもよい */
const isSeparator = (line: string) => /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(line.trim());

/** 行をセルに分ける。外側の | は、あってもなくても同じに読む。`\|` はセルの中の文字 */
const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());

/**
 * GFM の決まりで表を読む。| を含む見出しの行のすぐ下に区切りの行があれば表が始まり、空の行まで続く。
 * 行の頭の | で拾うと、外側の | を省いた行を黙って読み飛ばし、その行のリンクの欠けに気付けない
 */
function tablesIn(text: string) {
  const lines = text.split('\n');
  const tables: { header: string[]; rows: string[][] }[] = [];
  for (let index = 0; index < lines.length - 1; index++) {
    const line = lines[index] ?? '';
    if (!line.includes('|') || !isSeparator(lines[index + 1] ?? '')) continue;
    const rows: string[][] = [];
    let next = index + 2;
    for (; next < lines.length && lines[next]?.trim(); next++) rows.push(cellsOf(lines[next] ?? ''));
    tables.push({ header: cellsOf(line), rows });
    index = next;
  }
  return tables;
}

const hasIssueNumber = (cells: string[]) => cells.some((cell) => /#\d+/.test(cell));

/** セルの中の、リポジトリの中を指す相対リンクの先。外の URL は除く */
const relativeLinksIn = (cell: string) =>
  [...cell.matchAll(/\]\(([^)\s]+)\)/g)].map(([, target = '']) => target).filter((target) => !/^[a-z]+:/.test(target));

const isTestFile = (target: string) => /\.(test|spec)\.tsx?$/.test(target.split('#')[0] ?? '');

describe('tablesIn（GFM の表の読み方）', () => {
  const withPipes = [
    '| 守り | どこで | 確かめるテスト |',
    '| --- | --- | --- |',
    '| a | [x](x.ts) | [x](x.test.ts) |',
    '| b | リンクなし | リンクなし |',
  ].join('\n');
  // GFM では行の外側の | を省いてよい。oxfmt は付け直すが、テストはそれに頼らない
  const withoutPipes = [
    '守り | どこで | 確かめるテスト',
    ':--- | :---: | ---:',
    'a | [x](x.ts) | [x](x.test.ts)',
    'b | リンクなし | リンクなし',
  ].join('\n');

  it.each([
    ['外側の | がある表', withPipes],
    ['外側の | を省いた表', withoutPipes],
  ])('%sの行を、同じセルとして読み、リンクの欠けた行に気付ける', (_, table) => {
    const [{ header, rows } = { header: [], rows: [] }] = tablesIn(table);
    expect(header).toEqual(['守り', 'どこで', '確かめるテスト']);
    expect(rows).toEqual([
      ['a', '[x](x.ts)', '[x](x.test.ts)'],
      ['b', 'リンクなし', 'リンクなし'],
    ]);
    expect(rows.filter(([, where = '']) => relativeLinksIn(where).length === 0)).toEqual([rows[1]]);
    expect(rows.filter(([, , tests = '']) => !relativeLinksIn(tests).some(isTestFile))).toEqual([rows[1]]);
  });

  it.each([
    ['外側の | がある表', '| 守り | Issue |\n| --- | --- |\n| a | #1 |\n| b | なし |'],
    ['外側の | を省いた表', '守り | Issue\n--- | ---\na | #1\nb | なし'],
  ])('%sで、Issue の番号の無い行に気付ける', (_, table) => {
    const [{ rows } = { rows: [] }] = tablesIn(table);
    expect(rows.filter((row) => !hasIssueNumber(row))).toEqual([['b', 'なし']]);
  });

  it('表は空の行で終わり、続く文を行にしない。区切りの行の無い | は表にしない', () => {
    const text = ['| a | b |', '| - | - |', '| 1 | 2 |', '', '文の中の a | b', '', 'x | y', 'z | w'].join('\n');
    expect(tablesIn(text)).toEqual([{ header: ['a', 'b'], rows: [['1', '2']] }]);
  });

  it('1つの節の中の表を、それぞれ読む', () => {
    const text = ['### 1', '', '| a |', '| - |', '| 1 |', '', '### 2', '', 'b |', '- |', '2 |'].join('\n');
    expect(tablesIn(text)).toEqual([
      { header: ['a'], rows: [['1']] },
      { header: ['b'], rows: [['2']] },
    ]);
  });
});

describe('脅威モデル（docs/security/threat-model.md）', () => {
  it.each(['守るもの', '攻撃者', '経路', '確かめた守り', 'これから入れる守り', '受け入れたリスク'])(
    '「%s」の節がある',
    (heading) => {
      expect(sectionOf(heading)).not.toBe('');
    },
  );

  describe('確かめた守りの表', () => {
    const tables = tablesIn(sectionOf('確かめた守り'));

    // 見出しの言葉や表の形を変えて行を読めなくなったとき、下の確かめが0件で黙って通らないようにする
    it('表があり、どの表にも行がある', () => {
      expect(tables.length).toBeGreaterThan(0);
      for (const { rows } of tables) expect(rows.length).toBeGreaterThan(0);
    });

    it('どの表も、列は「守り｜どこで｜確かめるテスト」の順にする', () => {
      for (const { header } of tables) expect(header).toEqual(['守り', 'どこで', '確かめるテスト']);
    });

    const cells = tables.flatMap(({ rows }) =>
      rows.map(([defense = '', where = '', tests = '']) => ({ defense, where, tests })),
    );

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
    const rows = tablesIn(sectionOf('これから入れる守り')).flatMap((table) => table.rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => !hasIssueNumber(row))).toEqual([]);
  });
});
