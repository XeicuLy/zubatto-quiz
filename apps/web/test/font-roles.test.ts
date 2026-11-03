// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { filesUsing } from './screen-files';

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
    expect(files.filter((path) => !/^(features\/host|shared\/results)\//.test(path))).toEqual([]);
    // results のうち、回答者画面だけで使う部品
    expect(files).not.toContain('shared/results/MyPosition.tsx');
    expect(files).not.toContain('shared/results/QuestionResult.tsx');
  });

  it('前の名前 font-display は、もう使わない', () => {
    expect(filesUsing('font-display')).toEqual([]);
  });
});
