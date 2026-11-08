// @vitest-environment node
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { storyFiles } from './story-files';

/** いま src にあるストーリーのファイル。glob の結果と比べるため、ディスクから毎回読む */
const filesOnDisk = readdirSync(fileURLToPath(new URL('../src/', import.meta.url)), {
  recursive: true,
  encoding: 'utf8',
})
  .filter((path) => path.endsWith('.stories.tsx'))
  .map((path) => `../src/${path.replaceAll('\\', '/')}`)
  .sort();

describe('煙テストが読むストーリーのファイル', () => {
  it('src にストーリーがある（glob が1つも当たらないまま通らない）', () => {
    expect(filesOnDisk.length).toBeGreaterThan(0);
  });

  // vitest の fsModuleCache に、前の変換で埋め込んだファイルの一覧が残ると、足したストーリーを煙テストが描かないまま通る（story-files.ts）
  it('glob の結果が、いま src にあるストーリーのファイルとそろう', () => {
    expect(Object.keys(storyFiles).sort()).toEqual(filesOnDisk);
  });
});
