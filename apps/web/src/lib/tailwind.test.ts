import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/tailwind';

// styles.css の @theme の名前を cn が知っているかは、test/cn-theme.test.ts で確かめる（ファイルを読むので node で動かす）
describe('cn（部品の class をつなぐ）', () => {
  it('同じ性質の class が重なると、あとに書いたほうだけを残す', () => {
    expect(cn('bg-primary px-2', 'px-4')).toBe('bg-primary px-4');
  });

  it('false や undefined を落とす', () => {
    expect(cn('font-bold', false, undefined, 'text-sm')).toBe('font-bold text-sm');
  });
});
