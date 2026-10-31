import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { compile } from '@tailwindcss/node';
import { expect } from 'vitest';

/** styles.css を Tailwind でコンパイルし、渡したクラスの CSS を返す */
export async function buildCss(candidates: string[]): Promise<string> {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const compiler = await compile(css, {
    base: fileURLToPath(new URL('../src', import.meta.url)),
    onDependency: () => {},
  });
  return compiler.build(candidates);
}

/** コンパイルした CSS から、そのセレクタだけのブロック（`:root {` など）にある CSS 変数を読む */
export function variablesOf(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blocks = [...css.matchAll(new RegExp(String.raw`(?:^|\n)\s*${escaped} \{([^}]*)\}`, 'g'))];
  expect(blocks, `${selector} のブロックがちょうど1つある`).toHaveLength(1);
  return new Map([...blocks[0][1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

/** @theme の値（`@layer theme` の `:root, :host`）。`@layer properties` にも同じセレクタがあるので、theme の層だけを読む */
export function themeVariablesOf(css: string): Map<string, string> {
  return variablesOf(css.slice(css.indexOf('@layer theme {'), css.indexOf('@layer base {')), ':root, :host');
}

/** 変数がないまま undefined 同士を比べて通ってしまわないよう、ないときは落とす */
export function valueOf(variables: Map<string, string>, name: string): string {
  const value = variables.get(name);
  expect(value, `${name} がある`).toBeDefined();
  return value ?? '';
}
