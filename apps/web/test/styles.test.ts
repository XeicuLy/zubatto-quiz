// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildCss, themeVariablesOf, valueOf, variablesOf } from './compiled-css';

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
    ['font-numeral', 'font-family: var(--font-numeral)'],
    ['font-logo', 'font-family: var(--font-logo)'],
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

  it('飾り文字と本文のフォントを、同じオリジンから配る（CSP の font-src を広げない）', async () => {
    const css = await buildCss([]);

    expect(css).toMatch(/font-family: ['"]Dela Gothic One['"]/);
    expect(css).toMatch(/font-family: ['"]M PLUS 1 Variable['"]/);
    expect(css).not.toMatch(/url\(["']?https?:/);
  });
});

describe('字体の役割（飾り文字は投影の数字・順位とロゴだけ）', () => {
  it('投影の数字（font-numeral）とロゴ（font-logo）は Dela Gothic One、本文は M PLUS 1', async () => {
    const variables = themeVariablesOf(await buildCss(['font-numeral', 'font-logo', 'font-sans']));

    expect(valueOf(variables, '--font-numeral')).toMatch(/^['"]Dela Gothic One['"]/);
    expect(valueOf(variables, '--font-logo')).toBe(valueOf(variables, '--font-numeral'));
    expect(valueOf(variables, '--font-sans')).toMatch(/^['"]M PLUS 1 Variable['"]/);
  });

  it('前の名前 font-display は、もう CSS に出ない', async () => {
    expect(await buildCss(['font-display'])).not.toContain('--font-display');
  });

  it('太字の中でも、太さが 400 しかない Dela Gothic One をブラウザに太らせない', async () => {
    const css = await buildCss([]);
    const base = css
      .split('@layer ')
      .filter((block) => block.startsWith('base {'))
      .join('');

    expect(base).toMatch(/(?:^|\n)\s*html \{[^}]*font-synthesis-weight: none;/);
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
    // body の背景や、すべての要素の枠の色に、役割の色を当てない。--ring はフォーカスリング（下の describe）だけが使う
    expect(css.replace(focusVisibleRuleOf(css), '')).not.toMatch(/var\(--(background|foreground|border|ring)\)/);
  });
});

/**
 * @layer base の :focus-visible のルール（ブロックの中身）。ちょうど1つあることも確かめる。
 * styles.css に書いた @layer base は、preflight とは別のブロックとして utilities より後ろに出る（層の順番は先頭の宣言で決まる）
 */
function focusVisibleRuleOf(css: string): string {
  const base = css
    .split('@layer ')
    .filter((block) => block.startsWith('base {'))
    .join('');
  const rules = [...base.matchAll(/(?:^|\n)\s*:focus-visible \{([^}]*)\}/g)];
  expect(rules, ':focus-visible のルールがちょうど1つある').toHaveLength(1);
  return rules[0][1];
}

describe('文字の大きさと行間の段（デジタル庁デザインシステムの値を手本にする）', () => {
  it.each([
    // [名前, 大きさ, 行間, 字間, 手本にしたトークン]
    ['title', '1.75rem', '1.5', '0.01em', 'Std-28B-150'],
    ['heading', '1.25rem', '1.5', '0.02em', 'Std-20B-150'],
    ['body', '1rem', '1.7', '0.02em', 'Std-16N-170'],
    ['note', '0.875rem', '1.5', '0.02em', '14px の付随情報'],
    ['label', '1rem', '1', '0.02em', 'Oln-16B-100'],
  ])('text-%s は %s、行間 %s、字間 %s（%s）', async (name, size, lineHeight, letterSpacing) => {
    const css = await buildCss([`text-${name}`]);
    const variables = themeVariablesOf(css);

    expect(valueOf(variables, `--text-${name}`)).toBe(size);
    expect(valueOf(variables, `--text-${name}--line-height`)).toBe(lineHeight);
    expect(valueOf(variables, `--text-${name}--letter-spacing`)).toBe(letterSpacing);
    // 1つの class で、大きさ・行間・字間がそろって出る
    expect(css).toContain(`font-size: var(--text-${name})`);
    expect(css).toContain(`line-height: var(--tw-leading, var(--text-${name}--line-height))`);
    expect(css).toContain(`letter-spacing: var(--tw-tracking, var(--text-${name}--letter-spacing))`);
  });

  it('投影の vw のトークンは、そのまま残す', async () => {
    const variables = themeVariablesOf(await buildCss(['text-stage-label', 'text-question']));

    expect(valueOf(variables, '--text-stage-label')).toBe('clamp(0.875rem, 1.3vw, 1.5rem)');
    expect(valueOf(variables, '--text-question')).toBe('clamp(1.375rem, 3.6vw, 4.5rem)');
  });
});

describe('余白の段（8px を基本にした4段）', () => {
  it.each([
    // [名前, 値, 使う場所]
    ['related', '0.5rem', 'ラベルと入力のような、関係の近いもの同士'],
    ['item', '1rem', '並んだ項目の間と、部品の内側'],
    ['cluster', '1.5rem', 'まとまり同士の間'],
    ['section', '4rem', '節の間'],
  ])('%s は %s（%s）', async (name, value) => {
    const css = await buildCss([`gap-${name}`, `p-${name}`, `mt-${name}`]);

    expect(valueOf(themeVariablesOf(css), `--spacing-${name}`)).toBe(value);
    expect(css).toContain(`gap: var(--spacing-${name})`);
    expect(css).toContain(`padding: var(--spacing-${name})`);
    expect(css).toContain(`margin-top: var(--spacing-${name})`);
  });

  it('余白の名前が、回答者画面の列の幅（max-w-md）を変えない', async () => {
    expect(await buildCss(['max-w-md'])).toContain('max-width: var(--container-md)');
  });
});

describe('全体に効くフォーカスリング（ADR 0007）', () => {
  it('フォーカスの黄は、デジタル庁デザインシステムの Yellow-300（#ffd43d）で、面で変わらない', async () => {
    const css = await buildCss(['ring-focus']);

    expect(valueOf(themeVariablesOf(css), '--color-focus')).toBe('oklch(0.883 0.164 92)');
    expect(variablesOf(css, ':root').has('--focus')).toBe(false);
  });

  it(':focus-visible に、面ごとの --ring の outline 4px と、その内側の黄の ring 2px を重ねる', async () => {
    const rule = focusVisibleRuleOf(await buildCss([]));

    expect(rule).toContain('outline-width: 4px');
    expect(rule).toContain('outline-offset: 2px');
    expect(rule).toContain('outline-color: var(--ring)');
    expect(rule).toContain('0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color, currentcolor)');
    expect(rule).toContain('--tw-ring-color: var(--color-focus)');
  });

  it('早押しパネルの影（shadow-panel）と黄の ring は、打ち消し合わずに重なる', async () => {
    const css = await buildCss(['shadow-panel']);
    const shadowOf = (rule: string) => rule.match(/box-shadow: ([^;]+);/)?.[1];

    // どちらも Tailwind の影の変数をつないだ同じ式なので、影は --tw-shadow、ring は --tw-ring-shadow に入る
    expect(shadowOf(focusVisibleRuleOf(css))).toBeDefined();
    expect(shadowOf(focusVisibleRuleOf(css))).toBe(shadowOf(css.slice(css.indexOf('.shadow-panel {'))));
  });

  it('focus-target は、フォーカスを移すだけの投影の見出しから、outline と黄の ring の両方を消す', async () => {
    const rule = (await buildCss(['focus-target'])).match(/\.focus-target:focus \{([^}]*)\}/)?.[1];

    expect(rule).toContain('outline-style: none');
    expect(rule).toContain('--tw-ring-shadow: var(--tw-ring-inset,) 0 0 0 calc(0px + var(--tw-ring-offset-width))');
  });
});
