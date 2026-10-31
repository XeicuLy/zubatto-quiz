// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

/** src の画面のファイル（テストと自動生成のルート表を除く）を、src からの相対パスで返す */
const screenFiles = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
  .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !path.endsWith('routeTree.gen.ts'))
  .map((path) => path.replaceAll('\\', '/'))
  .sort();

function filesUsing(className: string): string[] {
  const pattern = new RegExp(String.raw`(?<![\w-])${className}(?![\w-])`);
  return screenFiles.filter((path) => pattern.test(readFileSync(`${srcDir}${path}`, 'utf8')));
}

describe('飾り文字（Dela Gothic One）を使う場所', () => {
  it('ロゴ（font-logo）は、アプリの名前を出す4画面だけ', () => {
    expect(filesUsing('font-logo')).toEqual([
      'features/admin/AdminLayout.tsx',
      'features/admin/LoginPage.tsx',
      'features/player/JoinForm.tsx',
      'routes/index.tsx',
    ]);
  });

  it('数字（font-numeral）は、投影に出す進行画面と results の部品だけで、回答者画面と管理画面では使わない', () => {
    const files = filesUsing('font-numeral');

    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((path) => !/^features\/(host|results)\//.test(path))).toEqual([]);
    // results のうち、回答者画面だけで使う部品
    expect(files).not.toContain('features/results/MyPosition.tsx');
    expect(files).not.toContain('features/results/QuestionResult.tsx');
  });

  it('前の名前 font-display は、もう使わない', () => {
    expect(filesUsing('font-display')).toEqual([]);
  });
});
