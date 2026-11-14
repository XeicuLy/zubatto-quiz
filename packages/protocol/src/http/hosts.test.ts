import { describe, expect, it } from 'vitest';

import { addHostRequestSchema, githubLoginSchema } from './hosts.ts';

describe('githubLoginSchema（ADR 0013）', () => {
  it.each(['octocat', 'a', 'Alice-Bob', 'x'.repeat(39), 'user-1', '-legacy-'])('%s を通す', (login) => {
    expect(githubLoginSchema.parse(login)).toBe(login);
  });

  it('前後の空白を取り除いた値を返す', () => {
    expect(githubLoginSchema.parse('  octocat\n')).toBe('octocat');
  });

  it.each([
    ['空', ''],
    ['空白だけ', '   '],
    ['40文字', 'x'.repeat(40)],
    ['スラッシュ（経路を書き換える）', 'octocat/repos'],
    ['ドット（.. で上の経路へ）', '..'],
    ['問い合わせの ?', 'octocat?per_page=1'],
    ['%（URL の符号）', '%2e%2e'],
    ['@ 付き', '@octocat'],
    ['間の空白', 'octo cat'],
    ['全角', 'ｏｃｔｏｃａｔ'],
  ])('%s は通さない', (_, login) => {
    expect(githubLoginSchema.safeParse(login).success).toBe(false);
  });

  it('追加の本文は login だけを持つ', () => {
    expect(addHostRequestSchema.parse({ login: 'octocat' })).toEqual({ login: 'octocat' });
    expect(addHostRequestSchema.safeParse({}).success).toBe(false);
  });
});
