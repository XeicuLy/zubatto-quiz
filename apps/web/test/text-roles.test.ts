// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { screenFiles, sourceOf } from './screen-files';

/**
 * Tailwind の既定の、大きさの名前の文字の class（text-xs〜text-9xl）。
 * md:text-xl のような variant 付きにも当たり、text-stage-label のような役割の名前には当たらないよう、class 名の切れ目で区切る
 */
const sizeNamed = /(?<![\w-])text-(?:xs|sm|base|lg|[2-9]?xl)(?![\w-])/g;

function sizeNamedIn(source: string): string[] {
  return [...source.matchAll(sizeNamed)].map(([name]) => name);
}

describe('文字の大きさは役割の名前で選ぶ（docs/design/README.md の「文字」）', () => {
  it('画面のファイル（テストとストーリーを除く）に、大きさの名前の文字の class がない', () => {
    const found = screenFiles.flatMap((path) => sizeNamedIn(sourceOf(path)).map((name) => `${path}: ${name}`));

    expect(found).toEqual([]);
  });

  it('大きさの名前には当たり、役割の名前には当たらない', () => {
    // text-xl/7 は、大きさと行の高さをまとめて書いたもの
    expect(sizeNamedIn('text-xs text-sm text-base text-lg md:text-xl text-2xl/7 text-7xl')).toEqual([
      'text-xs',
      'text-sm',
      'text-base',
      'text-lg',
      'text-xl',
      'text-2xl',
      'text-7xl',
    ]);
    expect(sizeNamedIn('text-title text-note text-lead text-display text-stage-label text-left')).toEqual([]);
  });
});
