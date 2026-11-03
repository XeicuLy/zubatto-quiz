// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildCss, themeVariablesOf, valueOf, variablesOf } from './compiled-css';

/**
 * 文字と背景のコントラスト比（WCAG 2.2 の 1.4.3）。ADR 0007 で、文字は投影でもスマホでも 4.5:1 以上にすると決めた。
 * 計算は oklch → OKLab → 線形 sRGB → 相対輝度 → (L1 + 0.05) / (L2 + 0.05)。依存を増やさないよう、ここに書く
 */
const minimumRatio = 4.5;

type Oklch = { l: number; c: number; h: number };

/** `oklch(0.6 0.22 25)` を読む。styles.css の色はすべてこの形で書いている */
function parseOklch(value: string): Oklch {
  const match = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  expect(match, `${value} は oklch(L C H) の形`).not.toBeNull();
  const [, l, c, h] = match ?? [];
  return { l: Number(l), c: Number(c), h: Number(h) };
}

/** oklch を線形 sRGB にする（OKLab の作者 Björn Ottosson の行列）。sRGB の外の色は、0 未満や 1 を超える値になる */
function toLinearSrgb({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ];
  return [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ];
}

/** 相対輝度。clip のときは sRGB の範囲に切り詰める（sRGB の画面に出たときの明るさ） */
function relativeLuminance(color: Oklch, clip: boolean): number {
  const [r, g, b] = toLinearSrgb(color).map((v) => (clip ? Math.min(1, Math.max(0, v)) : v));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 2色のコントラスト比。sRGB の外の色は、sRGB の画面では切り詰めて、P3 の画面（iPhone など）ではそのまま出て、
 * 明るさが少し変わる。どちらの画面でも読めるよう、2通りに測って低いほうを返す
 */
function contrastRatio(text: string, background: string): number {
  const ratios = [true, false].map((clip) => {
    const [lighter, darker] = [text, background]
      .map((value) => relativeLuminance(parseOklch(value), clip))
      .sort((x, y) => y - x);
    return (lighter + 0.05) / (darker + 0.05);
  });
  return Math.min(...ratios);
}

describe('コントラスト比の計算', () => {
  it.each([
    // [色, 相対輝度]。oklch の値は sRGB の原色と白黒を変換したもの
    ['oklch(1 0 0)', 1],
    ['oklch(0 0 0)', 0],
    ['oklch(0.627955 0.257683 29.2339)', 0.2126], // #ff0000
    ['oklch(0.86644 0.294827 142.4953)', 0.7152], // #00ff00
    ['oklch(0.452014 0.313214 264.052)', 0.0722], // #0000ff
  ])('%s の相対輝度は %s', (value, luminance) => {
    expect(relativeLuminance(parseOklch(value), true)).toBeCloseTo(luminance, 3);
  });

  it('白と黒は 21:1 で、文字と背景を入れ替えても同じ', () => {
    expect(contrastRatio('oklch(1 0 0)', 'oklch(0 0 0)')).toBeCloseTo(21, 2);
    expect(contrastRatio('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 2);
  });
});

/** 面で変わらない、このアプリだけの色（@theme）。[文字, 背景] */
const fixedPairs = [
  ['choice-1-foreground', 'choice-1'],
  ['choice-2-foreground', 'choice-2'],
  ['choice-3-foreground', 'choice-3'],
  ['choice-4-foreground', 'choice-4'],
  ['spotlight-foreground', 'spotlight'],
  ['correct-foreground', 'correct'],
  ['alert-foreground', 'alert'],
] as const;

/** 面ごとに入れ替わる役割の色（:root と .stage）。[文字, 背景] */
const surfacePairs = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['muted-foreground', 'muted'],
  // 補足の文字は、面の背景にもカードの上にも置く
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  // 入力欄の誤り（components/ui/field.tsx）は、面の背景に置く
  ['destructive', 'background'],
] as const;

/**
 * 面で変わらない色を、組の相手でなく暗い面（.stage）の上に置くもの。[面で変わらない色, 暗い面の役割の色]。
 * 回答者画面にしか出ないので、明るい面では測らない
 */
const fixedOnStageTextPairs = [
  // 「○ 正解」（shared/results/QuestionResult.tsx）は面の背景に、「▲ 順位が上がりました」（shared/results/MyPosition.tsx）はカードに置く
  ['correct', 'background'],
  ['correct', 'card'],
] as const;

/** 文字でない部品（WCAG 2.2 の 1.4.11）は、隣の色に 3:1 以上にする（ADR 0007） */
const nonTextMinimumRatio = 3;

/** 面ごとに入れ替わる役割の色で描く枠。[枠, 隣の色] */
const borderPairs = [
  // 入力欄（components/ui/field.tsx）の枠は、内側のカードの色と外側の面の背景の両方に接する
  ['muted-foreground', 'card'],
  ['muted-foreground', 'background'],
  // 誤りのときの入力欄の枠
  ['destructive', 'card'],
  ['destructive', 'background'],
] as const;

/** 面で変わらない色で描く枠を、暗い面の上に置くもの。[枠, 暗い面の役割の色] */
const fixedOnStageBorderPairs = [
  // 回答者の待機画面の「参加の情報を保存できない」の枠（player/WaitingRoom.tsx）
  ['alert', 'background'],
] as const;

/** 面で変わらない色（@theme）と、暗い面の役割の色（.stage）を、同じ CSS から読んで比べる */
async function fixedOnStageRatio(fixed: string, surfaceRole: string, utility: string): Promise<number> {
  const css = await buildCss([`${utility}-${fixed}`]);
  return contrastRatio(
    valueOf(themeVariablesOf(css), `--color-${fixed}`),
    valueOf(variablesOf(css, '.stage'), `--${surfaceRole}`),
  );
}

describe(`文字と背景のコントラストは ${minimumRatio}:1 以上（ADR 0007）`, () => {
  it.each(fixedPairs)('%s の文字を %s の上に置ける', async (text, background) => {
    const variables = themeVariablesOf(await buildCss([`text-${text}`, `bg-${background}`]));

    expect(
      contrastRatio(valueOf(variables, `--color-${text}`), valueOf(variables, `--color-${background}`)),
    ).toBeGreaterThanOrEqual(minimumRatio);
  });

  it.each(
    surfacePairs.flatMap(([text, background]) => [
      ['明るい面', ':root', text, background],
      ['暗い面', '.stage', text, background],
    ]),
  )('%s（%s）で、%s の文字を %s の上に置ける', async (_surface, selector, text, background) => {
    const variables = variablesOf(await buildCss([]), selector);

    expect(
      contrastRatio(valueOf(variables, `--${text}`), valueOf(variables, `--${background}`)),
    ).toBeGreaterThanOrEqual(minimumRatio);
  });

  it.each(fixedOnStageTextPairs)('暗い面（.stage）で、%s の文字を %s の上に置ける', async (text, background) => {
    expect(await fixedOnStageRatio(text, background, 'text')).toBeGreaterThanOrEqual(minimumRatio);
  });
});

describe(`枠は隣の色に ${nonTextMinimumRatio}:1 以上（ADR 0007）`, () => {
  it.each(
    borderPairs.flatMap(([border, background]) => [
      ['明るい面', ':root', border, background],
      ['暗い面', '.stage', border, background],
    ]),
  )('%s（%s）で、%s の枠を %s に接して置ける', async (_surface, selector, border, background) => {
    const variables = variablesOf(await buildCss([]), selector);

    expect(
      contrastRatio(valueOf(variables, `--${border}`), valueOf(variables, `--${background}`)),
    ).toBeGreaterThanOrEqual(nonTextMinimumRatio);
  });

  it.each(fixedOnStageBorderPairs)('暗い面（.stage）で、%s の枠を %s に接して置ける', async (border, background) => {
    expect(await fixedOnStageRatio(border, background, 'border')).toBeGreaterThanOrEqual(nonTextMinimumRatio);
  });
});
