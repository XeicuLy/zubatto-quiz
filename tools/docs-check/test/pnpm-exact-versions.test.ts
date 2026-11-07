import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type PnpmWorkspace = { packages: string[]; saveExact?: boolean };
type PackageJson = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const repoFile = (path: string) => readFileSync(`${repoRoot}${path}`, 'utf8');

const workspace = parse(repoFile('pnpm-workspace.yaml')) as PnpmWorkspace;

// workspace:* は同じリポジトリの中を指すので、版の範囲にならない
const isExact = (specifier: string) =>
  specifier === 'workspace:*' || /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(specifier);

describe('依存の完全固定', () => {
  it('pnpm add が完全固定で書く', () => {
    // pnpm 11 からは、認証とレジストリ以外の設定を .npmrc から読まない。save-exact を .npmrc に書いても効かない
    expect(workspace.saveExact).toBe(true);
  });

  it.each([
    ['1.2.3', true],
    ['0.68.0', true],
    ['1.0.0-beta.1', true],
    ['workspace:*', true],
    ['^1.2.3', false],
    ['~1.2.3', false],
    ['>=1.2.3', false],
    ['1.2', false],
    ['1.x', false],
    ['*', false],
    ['latest', false],
    ['workspace:^', false],
  ])('%s の判定は %s', (specifier, expected) => {
    expect(isExact(specifier)).toBe(expected);
  });

  const manifests = [
    'package.json',
    ...workspace.packages.flatMap((pattern) => globSync(`${pattern}/package.json`, { cwd: repoRoot })),
  ];

  it('workspace の package.json を見つけられている', () => {
    expect(manifests).toEqual(
      expect.arrayContaining(['package.json', 'apps/api/package.json', 'tools/docs-check/package.json']),
    );
  });

  // saveExact が効くのは pnpm add だけなので、手で書いた範囲の指定はここで止める
  it.each(manifests)('%s の依存に範囲の指定がない', (path) => {
    const manifest = JSON.parse(repoFile(path)) as PackageJson;
    const specifiers = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(specifiers.filter(([, specifier]) => !isExact(specifier))).toEqual([]);
  });
});
