// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildCss, themeVariablesOf } from './compiled-css';
import { screenFiles, sourceOf } from './screen-files';

/**
 * 役割の名前（ADR 0007）に移す前の色の名前（#134 で消した）。
 * Tailwind は知らない class を黙って捨てるので、画面に書き戻しても色が抜けるだけで、型もほかのテストも落ちない
 */
const legacyColors = [
  'stage',
  'stage-raised',
  'stage-line',
  'on-stage',
  'on-stage-muted',
  'on-choice',
  'on-choice-4',
  'on-spotlight',
  'alert-strong',
  'backstage',
  'backstage-surface',
  'backstage-line',
  'backstage-ink',
  'backstage-muted',
];

/** 色を受け取る utility。p-stage・gap-stage（投影の余白）と text-stage-label（投影の文字）は、残る名前なので当てない */
const colorUtilities = [
  'bg',
  'text',
  'border',
  'border-[xytrbl]',
  'divide',
  'outline',
  'ring',
  'ring-offset',
  'accent',
  'fill',
  'stroke',
  'decoration',
  'shadow',
  'caret',
  'placeholder',
  'from',
  'via',
  'to',
];

const legacyClass = new RegExp(
  String.raw`(?<![\w-])(?:${colorUtilities.join('|')})-(?:${legacyColors.join('|')})(?:/\d+)?(?![\w-])`,
  'g',
);

describe('前の色の名前（stage・backstage・on-*・alert-strong）', () => {
  it('画面のファイルで、もう使わない', () => {
    const usages = screenFiles.flatMap((path) =>
      [...sourceOf(path).matchAll(legacyClass)].map(([className]) => `${path}: ${className}`),
    );

    expect(usages).toEqual([]);
  });

  it('styles.css に、もう名前がない（書き戻しても CSS が出ない）', async () => {
    const variables = themeVariablesOf(await buildCss(legacyColors.map((name) => `bg-${name}`)));

    expect(legacyColors.filter((name) => variables.has(`--color-${name}`))).toEqual([]);
  });

  it('暗い面の印（.stage）と投影の大きさ（text-stage-label・p-stage）は、前の名前に数えない', () => {
    legacyClass.lastIndex = 0;
    expect('stage text-stage-label text-stage-title p-stage gap-stage px-stage'.match(legacyClass)).toBeNull();
    expect('bg-stage/25 focus-visible:outline-on-stage border-t-backstage-line'.match(legacyClass)).toEqual([
      'bg-stage/25',
      'outline-on-stage',
      'border-t-backstage-line',
    ]);
  });
});
