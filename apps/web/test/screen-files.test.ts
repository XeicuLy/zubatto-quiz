// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { screenFiles } from './screen-files';

describe('screenFiles（font-roles・color-roles が画面として読むファイル）', () => {
  it('テストとストーリーを含めない。部品の使い方の例を、画面の class の使い方として数えない', () => {
    expect(screenFiles.filter((path) => /\.(test|stories)\.tsx?$/.test(path))).toEqual([]);
  });

  it('部品のファイルは含める', () => {
    expect(screenFiles).toContain('components/ui/button.tsx');
  });
});
