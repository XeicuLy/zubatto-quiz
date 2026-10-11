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
