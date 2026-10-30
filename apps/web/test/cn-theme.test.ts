// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { cn } from '../src/lib/tailwind';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/** styles.css の @theme で足した名前を、種類（Tailwind の名前空間）ごとに読む。行間（--text-*--line-height）は除く */
function themeNames(namespace: string): string[] {
  const pattern = new RegExp(String.raw`^\s*--${namespace}-([\w-]+?):`, 'gm');
  return [...new Set([...styles.matchAll(pattern)].map(([, name]) => name).filter((name) => !name.includes('--')))];
}

/** 種類ごとに、自分の名前の class と、同じ性質を持つ Tailwind の既定の class */
const sameKind = {
  color: (name: string) => [`bg-${name}`, 'bg-transparent'],
  text: (name: string) => [`text-${name}`, 'text-sm'],
  font: (name: string) => [`font-${name}`, 'font-mono'],
  spacing: (name: string) => [`p-${name}`, 'p-4'],
  radius: (name: string) => [`rounded-${name}`, 'rounded-lg'],
  shadow: (name: string) => [`shadow-${name}`, 'shadow-none'],
  animate: (name: string) => [`animate-${name}`, 'animate-none'],
} as const;

const themeClasses = Object.entries(sameKind).flatMap(([namespace, classesOf]) =>
  themeNames(namespace).map((name) => classesOf(name)),
);

describe('cn が styles.css の @theme の名前を知っている', () => {
  it('styles.css の @theme から名前を読めている', () => {
    expect(themeClasses).toContainEqual(['text-stage-label', 'text-sm']);
    expect(themeClasses).toContainEqual(['bg-primary-foreground', 'bg-transparent']);
  });

  it.each(themeClasses)('%s は、同じ性質の %s に置き換わる', (mine, tailwind) => {
    expect(cn(mine, tailwind)).toBe(tailwind);
  });

  it.each(themeNames('text'))('文字の大きさ text-%s と文字の色を重ねても、両方残る', (name) => {
    expect(cn(`text-${name}`, 'text-primary-foreground')).toBe(`text-${name} text-primary-foreground`);
  });

  it.each(themeNames('font'))('字体 font-%s と文字の太さを重ねても、両方残る', (name) => {
    expect(cn(`font-${name}`, 'font-bold')).toBe(`font-${name} font-bold`);
  });
});
