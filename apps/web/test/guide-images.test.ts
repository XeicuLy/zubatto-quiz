// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { GUIDE_VIEWPORTS, hostSteps, playerSteps } from '@/features/guide/guide-steps';

/** 使い方の画像の置き場所。e2e/guide-screenshots/capture.ts（pnpm run guide:shots）がここへ撮る */
const imagesDir = new URL('../src/features/guide/images/', import.meta.url);
const steps = [...hostSteps, ...playerSteps];

/** PNG の先頭の IHDR から、幅と高さを読む（8バイトの印のあと、長さ・種類の8バイトに続く） */
function pngSize(name: string) {
  const bytes = readFileSync(new URL(`${name}.png`, imagesDir));
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('使い方の画像（guide-steps.ts と images/）', () => {
  it.each(steps.map((step) => [step.image, step] as const))('%s.png があり、alt が空でない', (name, step) => {
    expect(existsSync(new URL(`${name}.png`, imagesDir))).toBe(true);
    expect(step.alt.trim()).not.toBe('');
  });

  // <img> の width・height は device から書く。撮った大きさと違うと、読み込んだときに場所がずれる
  it.each(steps.map((step) => [step.image, step] as const))(
    '%s.png は、device の画面の大きさで撮ってある',
    (name, step) => {
      expect(pngSize(name)).toEqual(GUIDE_VIEWPORTS[step.device]);
    },
  );

  it('同じ画像を2つの手順で使わない', () => {
    const names = steps.map((step) => step.image);

    expect(new Set(names).size).toBe(names.length);
  });

  // 手順を消したのに画像だけ残ると、撮り直すたびに使わない画像を撮ってしまう
  it('どの手順も使わない画像を置かない', () => {
    const files = readdirSync(imagesDir).filter((file) => file.endsWith('.png'));

    expect(files.sort()).toEqual(steps.map((step) => `${step.image}.png`).sort());
  });
});
