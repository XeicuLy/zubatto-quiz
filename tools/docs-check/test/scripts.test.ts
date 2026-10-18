import { existsSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { documents, read, repoRoot } from './documents';

type PackageJson = { name: string; scripts?: Record<string, string> };

const readPackage = (dir: string) => JSON.parse(read(new URL(`${dir}/package.json`, repoRoot))) as PackageJson;

const rootPackage = readPackage('.');

/** workspace のパッケージ（apps/*・packages/*・tools/*）を、`--filter` に書く名前で引く */
const workspacePackages = new Map(
  ['apps', 'packages', 'tools']
    .flatMap((group) => readdirSync(new URL(`${group}/`, repoRoot)).map((dir) => `${group}/${dir}`))
    .filter((dir) => existsSync(new URL(`${dir}/package.json`, repoRoot)))
    .map((dir) => readPackage(dir))
    .map((pkg) => [pkg.name, pkg]),
);

/** 文書に書いた `pnpm [-s] [--filter <名前>] run <スクリプト>`。`pnpm exec ...` は含まない */
const scriptRuns = documents.flatMap((document) =>
  [...read(new URL(document, repoRoot)).matchAll(/pnpm (?:-s |--silent )?(?:--filter (\S+) )?run ([\w:-]+)/g)].map(
    ([command, filter, script = '']) => ({ document, command, filter, script }),
  ),
);

describe('手順書に書いたスクリプト', () => {
  it('手順書に pnpm run のコマンドがある', () => {
    // 1つも拾えないと、下の it.each が0件になり、何も確かめないまま通ってしまう
    expect(scriptRuns.length).toBeGreaterThan(0);
  });

  it.each(scriptRuns)('$document の「$command」のスクリプトが package.json にある', ({ filter, script }) => {
    // --filter がなければ root の package.json。名前を書き間違えたパッケージは引けず、undefined になって落ちる
    const pkg = filter === undefined ? rootPackage : workspacePackages.get(filter);
    // スクリプト名には `:` が入るので、パスの文字列ではなく配列で渡す
    expect(pkg?.scripts).toHaveProperty([script]);
  });
});
