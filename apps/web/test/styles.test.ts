// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { compile } from '@tailwindcss/node';
import { describe, expect, it } from 'vitest';

/** styles.css を Tailwind でコンパイルし、渡したクラスの CSS を返す */
async function buildCss(candidates: string[]): Promise<string> {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const compiler = await compile(css, {
    base: fileURLToPath(new URL('../src', import.meta.url)),
    onDependency: () => {},
  });
  return compiler.build(candidates);
}

/** コンパイルした CSS から、そのセレクタだけのブロック（`:root {` など）にある CSS 変数を読む */
function variablesOf(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blocks = [...css.matchAll(new RegExp(String.raw`(?:^|\n)\s*${escaped} \{([^}]*)\}`, 'g'))];
  expect(blocks, `${selector} のブロックがちょうど1つある`).toHaveLength(1);
  return new Map([...blocks[0][1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

/** @theme の値（`@layer theme` の `:root, :host`）。`@layer properties` にも同じセレクタがあるので、theme の層だけを読む */
function themeVariablesOf(css: string): Map<string, string> {
  return variablesOf(css.slice(css.indexOf('@layer theme {'), css.indexOf('@layer base {')), ':root, :host');
}

/** 変数がないまま undefined 同士を比べて通ってしまわないよう、ないときは落とす */
function valueOf(variables: Map<string, string>, name: string): string {
  const value = variables.get(name);
  expect(value, `${name} がある`).toBeDefined();
  return value ?? '';
}

/**
 * 役割の名前（shadcn/ui の名前、ADR 0007）と、同じ値を持つ今の名前。
 * 明るい面（管理画面）は :root、暗い面（進行画面・回答者画面）は .stage の中で値が入れ替わる
 */
const surfaceRoles = [
  // [役割, 明るい面, 暗い面]
  ['background', 'backstage', 'stage'],
  ['foreground', 'backstage-ink', 'on-stage'],
  ['card', 'backstage-surface', 'stage-raised'],
  ['card-foreground', 'backstage-ink', 'on-stage'],
  ['popover', 'backstage-surface', 'stage-raised'],
  ['popover-foreground', 'backstage-ink', 'on-stage'],
  ['primary', 'stage', 'on-stage'],
  ['primary-foreground', 'on-stage', 'stage'],
  ['secondary', 'backstage', 'stage-raised'],
  ['secondary-foreground', 'backstage-ink', 'on-stage'],
  ['muted', 'backstage', 'stage-raised'],
  ['muted-foreground', 'backstage-muted', 'on-stage-muted'],
  ['accent', 'backstage', 'stage-raised'],
  ['accent-foreground', 'backstage-ink', 'on-stage'],
  ['destructive', 'alert-strong', 'alert'],
  ['destructive-foreground', 'on-choice', 'stage'],
  ['border', 'backstage-line', 'stage-line'],
  ['input', 'backstage-line', 'stage-line'],
  ['ring', 'stage', 'on-stage'],
] as const;

/** 面で変わらない、このアプリだけの色の文字の色。<名前>-foreground の組にそろえる */
const fixedRoles = [
  // [役割, 今の名前]
  ['choice-1-foreground', 'on-choice'],
  ['choice-2-foreground', 'on-choice'],
  ['choice-3-foreground', 'on-choice'],
  ['choice-4-foreground', 'on-choice-4'],
  ['spotlight-foreground', 'on-spotlight'],
  ['correct-foreground', 'stage'],
  ['alert-foreground', 'stage'],
] as const;

/** 今の名前の色を全部使い、その値を CSS に出させる */
const currentColors = [
  ...new Set([
    ...surfaceRoles.flatMap(([, light, dark]) => [light, dark]),
    ...fixedRoles.map(([, current]) => current),
  ]),
];

describe('styles.css の @theme（T1 のトークン）', () => {
  it.each([
    ['bg-stage', 'background-color: var(--color-stage)'],
    ['text-on-choice-4', 'color: var(--color-on-choice-4)'],
    ['bg-spotlight', 'background-color: var(--color-spotlight)'],
    ['text-backstage-ink', 'color: var(--color-backstage-ink)'],
    ['font-display', 'font-family: var(--font-display)'],
    ['text-question', 'font-size: var(--text-question)'],
    ['p-stage', 'padding: var(--spacing-stage)'],
    ['rounded-panel', 'border-radius: var(--radius-panel)'],
    ['shadow-panel', '--tw-shadow: 0 0.375rem 0 0 var(--tw-shadow-color, oklch(0.15 0.06 274 / 0.55))'],
    ['animate-spotlight-in', 'animation: var(--animate-spotlight-in)'],
  ])('%s を使うと、%s が出る', async (candidate, declaration) => {
    expect(await buildCss([candidate])).toContain(declaration);
  });

  it('名前の出し方のユーティリティ（name-clip・name-wrap・text-phrase）を使える', async () => {
    const css = await buildCss(['name-clip', 'name-wrap', 'text-phrase']);

    expect(css).toContain('text-overflow: ellipsis');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('word-break: auto-phrase');
  });

  it('見出しと本文のフォントを、同じオリジンから配る（CSP の font-src を広げない）', async () => {
    const css = await buildCss([]);

    expect(css).toMatch(/font-family: ['"]Dela Gothic One['"]/);
    expect(css).toMatch(/font-family: ['"]M PLUS 1 Variable['"]/);
    expect(css).not.toMatch(/url\(["']?https?:/);
  });
});

describe('役割で名前を付けた色（ADR 0007）', () => {
  it.each(surfaceRoles)('%s は、明るい面で %s、暗い面で %s と同じ値', async (role, light, dark) => {
    const css = await buildCss(currentColors.map((name) => `bg-${name}`));
    const current = themeVariablesOf(css);

    expect(valueOf(variablesOf(css, ':root'), `--${role}`)).toBe(valueOf(current, `--color-${light}`));
    expect(valueOf(variablesOf(css, '.stage'), `--${role}`)).toBe(valueOf(current, `--color-${dark}`));
  });

  it('面ごとの値は上の表の役割だけで、明るい面と暗い面で同じ名前がそろう', async () => {
    const css = await buildCss([]);
    const roles = surfaceRoles.map(([role]) => `--${role}`).sort();

    expect([...variablesOf(css, ':root').keys()].sort()).toEqual(roles);
    expect([...variablesOf(css, '.stage').keys()].sort()).toEqual(roles);
  });

  it.each(surfaceRoles)('bg-%s は、面ごとに入れ替わる変数を直接読む', async (role) => {
    expect(await buildCss([`bg-${role}`])).toContain(`background-color: var(--${role})`);
  });

  it('部品の dark: は、暗い面（.stage とその中）で効く', async () => {
    expect(await buildCss(['dark:bg-input'])).toContain(':where(.stage, .stage *)');
  });

  it.each(fixedRoles)('%s は %s と同じ値', async (role, current) => {
    const variables = themeVariablesOf(await buildCss([`bg-${role}`, `bg-${current}`]));

    expect(valueOf(variables, `--color-${role}`)).toBe(valueOf(variables, `--color-${current}`));
  });

  it('shadcn の init が足す、今の見た目を変える指定を入れない', async () => {
    const css = await buildCss(['font-sans', 'rounded-lg']);

    // 本文の字体は M PLUS 1 のまま（Geist にしない）
    expect(css).toMatch(/--font-sans: ['"]M PLUS 1 Variable['"]/);
    expect(css).not.toContain('Geist');
    // 角の丸みは Tailwind の既定のまま
    expect(css).toContain('--radius-lg: 0.5rem');
    // body の背景や、すべての要素の枠とフォーカスの色に、役割の色を当てない
    expect(css).not.toMatch(/var\(--(background|foreground|border|ring)\)/);
  });
});
