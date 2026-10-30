import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { read, repoRoot } from './documents';

const docsIndex = new URL('docs/README.md', repoRoot);

const adrFiles = readdirSync(new URL('docs/adr/', repoRoot)).filter((name) => /^\d{4}-.+\.md$/.test(name));

/** ADR の `## Status` のすぐ下に書いた状態（accepted など） */
function statusOf(adrFile: string) {
  const [, status = ''] = /^## Status\s*\n+(.+)$/m.exec(read(new URL(`docs/adr/${adrFile}`, repoRoot))) ?? [];
  return status.trim();
}

/** 一覧の表で、その ADR へリンクしている行 */
const rowsLinkingTo = (adrFile: string) =>
  read(docsIndex)
    .split('\n')
    .filter((line) => line.startsWith('|') && line.includes(`](adr/${adrFile})`));

/** 表の行の最後の列。一覧では状態の列 */
const lastCellOf = (row: string) => row.split('|').slice(1, -1).at(-1)?.trim() ?? '';

describe('docs/README.md の ADR の一覧', () => {
  it('README から docs/README.md へのリンクがある', () => {
    expect(read(new URL('README.md', repoRoot))).toContain('](docs/README.md)');
  });

  // ADR を足したのに一覧を直し忘れると、入口から読む人がその ADR にたどり着けない
  it.each(adrFiles)('%s が一覧にちょうど1行ある', (adrFile) => {
    expect(rowsLinkingTo(adrFile)).toHaveLength(1);
  });

  // 「一部を ADR 0010 で変えた」のような添え書きは許し、状態の言葉そのものは ADR と合わせる
  it.each(adrFiles)('%s の一覧の状態が、ADR の Status で始まる', (adrFile) => {
    const [row = ''] = rowsLinkingTo(adrFile);
    expect(statusOf(adrFile)).not.toBe('');
    expect(lastCellOf(row).startsWith(statusOf(adrFile))).toBe(true);
  });
});
